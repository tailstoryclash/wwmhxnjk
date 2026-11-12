# evaluate_mlp.py
"""Train one small MLP candidate on synthetic history windows; never controls input."""
import argparse
from collections import deque
import csv
import gzip
import json
from pathlib import Path
import time
import numpy as np
from evaluate_offline_tracking import trajectory
from offline_tracking import Tracker

HORIZONS=(0.,.016,.033,.05,.1)
KINDS=('velocity','acceleration','turns','oscillation')


def dataset(seed, repeats):
    rng=np.random.default_rng(seed)
    features=[];targets=[];baselines=[];groups=[];origins=[]
    for repeat in range(repeats):
        for kind_index,kind in enumerate(KINDS):
            for noise in (4.,12.):
                stamps=np.cumsum(rng.uniform(.008,.025,480))
                angle=float(rng.uniform(0,6));rotation=float(rng.uniform(0,2*np.pi));scale=float(rng.uniform(.5,1.5))
                matrix=scale*np.array([[np.cos(rotation),-np.sin(rotation)],[np.sin(rotation),np.cos(rotation)]])
                actual=trajectory(stamps,kind,angle)@matrix.T
                measurements=actual+rng.normal(0,noise,actual.shape)
                observed=(rng.random(len(stamps))>.1)&~((stamps>4)&(stamps<4.8))
                tracker=Tracker('kalman',noise_px=noise);history=deque(maxlen=8);latest=None;epoch=0
                for index,stamp in enumerate(stamps):
                    tracker.update(float(stamp),measurements[index] if observed[index] else None,.8)
                    estimate=tracker.predict(0)
                    if estimate is None or epoch!=tracker.resets:
                        history.clear();latest=None;epoch=tracker.resets
                    if observed[index]:latest=measurements[index]
                    if latest is None:continue
                    history.append((stamp,latest.copy(),observed[index]))
                    if len(history)!=8 or index<60 or estimate is None:continue
                    base=[]
                    for historical_time,position,present in history:
                        base.extend(((position[0]-latest[0])/100,(position[1]-latest[1])/100,(historical_time-stamp)/.25,float(present)))
                    for horizon_index,horizon in enumerate(HORIZONS):
                        features.append(base+[horizon/.1])
                        target=trajectory(stamp+horizon,kind,angle)@matrix.T
                        targets.append((target-latest)/100)
                        baselines.append((tracker.predict(horizon)-latest)/100)
                        groups.append((kind_index,int(noise),horizon_index))
                        origins.append((repeat,float(stamp),float(latest[0]),float(latest[1])))
    return tuple(np.asarray(array) for array in (features,targets,baselines,groups,origins))


def initialize(seed):
    rng=np.random.default_rng(seed)
    return [rng.normal(0,np.sqrt(2/(33+32)),(33,32)).astype(np.float32),np.zeros(32,np.float32),
            rng.normal(0,np.sqrt(2/64),(32,32)).astype(np.float32),np.zeros(32,np.float32),
            rng.normal(0,np.sqrt(2/34),(32,2)).astype(np.float32),np.zeros(2,np.float32)]


def forward(features,weights):
    first=np.tanh(features@weights[0]+weights[1]);second=np.tanh(first@weights[2]+weights[3])
    return second@weights[4]+weights[5]


def gradients(features,targets,weights):
    first=np.tanh(features@weights[0]+weights[1]);second=np.tanh(first@weights[2]+weights[3]);prediction=second@weights[4]+weights[5]
    residual=prediction-targets;upstream=residual/len(features)
    output_w,output_b=second.T@upstream,upstream.sum(axis=0)
    second_gradient=(upstream@weights[4].T)*(1-second**2)
    second_w,second_b=first.T@second_gradient,second_gradient.sum(axis=0)
    first_gradient=(second_gradient@weights[2].T)*(1-first**2)
    first_w,first_b=features.T@first_gradient,first_gradient.sum(axis=0)
    return float(np.mean(residual**2)),[first_w,first_b,second_w,second_b,output_w,output_b]


def check_gradients():
    rng=np.random.default_rng(41);features=rng.normal(0,.1,(4,33));targets=rng.normal(0,.1,(4,2));weights=[w.astype(np.float64) for w in initialize(51)]
    loss,analytical=gradients(features,targets,weights)
    for layer in range(6):
        index=tuple(0 for _ in weights[layer].shape);original=weights[layer][index];epsilon=1e-6
        weights[layer][index]=original+epsilon;high=float(np.mean((forward(features,weights)-targets)**2))
        weights[layer][index]=original-epsilon;low=float(np.mean((forward(features,weights)-targets)**2))
        weights[layer][index]=original
        np.testing.assert_allclose(analytical[layer][index],(high-low)/(2*epsilon),rtol=1e-5,atol=1e-8)
    return loss


def train(train_set,validation_set,seed):
    rng=np.random.default_rng(seed);weights=initialize(seed);momentum=[np.zeros_like(w) for w in weights];variance=[np.zeros_like(w) for w in weights]
    features,targets=train_set[0].astype(np.float32),train_set[1].astype(np.float32)
    if len(features)>16000:
        selected=rng.choice(len(features),16000,replace=False);features,targets=features[selected],targets[selected]
    valid_features,valid_targets=validation_set[0].astype(np.float32),validation_set[1].astype(np.float32)
    best=None;best_loss=float('inf');steps=0;history=[]
    for epoch in range(32):
        indices=rng.permutation(len(features))
        for begin in range(0,len(features),256):
            batch=indices[begin:begin+256];loss,derivatives=gradients(features[batch],targets[batch],weights);steps+=1
            magnitude=float(np.sqrt(sum(np.sum(d*d) for d in derivatives)));factor=min(1.,5/max(1e-12,magnitude))
            for index,derivative in enumerate(derivatives):
                derivative=derivative*factor;momentum[index]=.9*momentum[index]+.1*derivative;variance[index]=.999*variance[index]+.001*derivative**2
                weights[index]-=.001*(momentum[index]/(1-.9**steps))/(np.sqrt(variance[index]/(1-.999**steps))+1e-8)
        validation_loss=float(np.mean((forward(valid_features,weights)-valid_targets)**2))
        if not np.isfinite(validation_loss):raise ArithmeticError('Nonfinite validation loss')
        history.append(dict(epoch=epoch+1,validation_rmse_px=float(np.sqrt(validation_loss)*100)))
        if validation_loss<best_loss:best_loss=validation_loss;best=[w.copy() for w in weights]
    return best,history


def evaluate(seed,output):
    output.mkdir(parents=True,exist_ok=False);check_gradients();began=time.perf_counter()
    train_set=dataset(40000+seed,2);validation_set=dataset(50000+seed,1);test_set=dataset(60000+seed,1)
    weights,learning_curve=train(train_set,validation_set,seed)
    np.savez_compressed(output/'weights.npz',**{f'parameter_{index}':weight for index,weight in enumerate(weights)})
    features,targets,kalman,groups,origins=test_set
    forecasts=forward(features.astype(np.float32),weights)
    if not np.isfinite(forecasts).all():raise ArithmeticError('Nonfinite MLP forecast')
    summaries=[]
    for kind_index,kind in enumerate(KINDS):
        for noise in (4,12):
            for horizon_index,horizon in enumerate(HORIZONS):
                selected=(groups[:,0]==kind_index)&(groups[:,1]==noise)&(groups[:,2]==horizon_index)
                for method,predictions in [('kalman',kalman),('mlp',forecasts)]:
                    errors=(predictions[selected]-targets[selected])*100
                    summaries.append(dict(trajectory=kind,noise_px=noise,horizon_s=horizon,method=method,samples=len(errors),coordinate_mae_px=float(np.abs(errors).mean()),coordinate_rmse_px=float(np.sqrt((errors**2).mean()))))
    with gzip.open(output/'predictions.csv.gz','wt',newline='') as stream:
        writer=csv.writer(stream);writer.writerow(('trajectory','noise_px','horizon_s','time_s','actual_x','actual_y','kalman_x','kalman_y','mlp_x','mlp_y'))
        for index in range(len(features)):
            kind,noise,horizon=groups[index];origin=origins[index,2:4]
            writer.writerow((KINDS[int(kind)],noise,HORIZONS[int(horizon)],origins[index,1],*(origin+100*targets[index]),*(origin+100*kalman[index]),*(origin+100*forecasts[index])))
    timings=[]
    for index in range(min(2000,len(features))):
        sample=features[index:index+1].astype(np.float32);start=time.perf_counter_ns();forward(sample,weights);timings.append((time.perf_counter_ns()-start)/1000)
    report=dict(seed=seed,scope='Paired synthetic-only Kalman versus one 33-32-32-2 tanh MLP, 8-step history, time deltas/dropout masks/horizon; disjoint train/validation/test seeds, rotation/scale augmentation',
                limitations='No real logs, no detector mAP; other CNN/GRU/LSTM/TCN architectures not trained. MLP timing excludes feature preparation, and is not whole-pipeline latency. No deployment selection from this experiment alone.',
                train_examples=min(16000,len(train_set[0])),validation_examples=len(validation_set[0]),test_examples=len(features),
                parameter_count=sum(w.size for w in weights),elapsed_s=time.perf_counter()-began,
                mlp_forward_us_p50=float(np.quantile(timings,.5)),mlp_forward_us_p99=float(np.quantile(timings,.99)),learning_curve=learning_curve,results=summaries)
    (output/'summary.json').write_text(json.dumps(report,indent=2,allow_nan=False));print(json.dumps(dict(seed=seed,elapsed_s=report['elapsed_s'],results=len(summaries))),flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--seed',type=int,required=True);parser.add_argument('--output-dir',type=Path,required=True)
    arguments=parser.parse_args();evaluate(arguments.seed,arguments.output_dir)
