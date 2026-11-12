#!/usr/bin/env python3
"""Summarize Albion F10 jitter-trace-v2. Read only; no device or game interaction.

Usage: python analyze_tracking_trace.py trace1.csv [trace2.csv ...] --output report.json
Requires pandas. Timing and lead metrics do not establish accuracy or delivery.
"""
from pathlib import Path
import argparse
import csv
import json
import pandas as pd

NUMERIC = ['frame_id','observed_ms','captured_ms','image_ms','result_age_ms',
           'acquire_delay_ms','inference_ms','active','found','async_mode',
           'lead_x','lead_y','prediction_enabled','send_attempted','px_per_count',
           'command_begin_ms','command_end_ms']

def summarize(path: Path):
    with path.open('r',encoding='utf-8-sig',newline='') as f:
        metadata = f.readline().strip()
        if not metadata.startswith('# jitter-trace-v2;'):
            raise ValueError(f'{path.name}: not jitter-trace-v2')
        reader = csv.DictReader(f)
        independent_count = sum(1 for _ in reader)
    data = pd.read_csv(path,comment='#')
    missing = sorted(set(NUMERIC)-set(data.columns))
    if missing:
        raise ValueError(f'{path.name}: missing fields {missing}')
    if len(data)!=independent_count:
        raise ValueError(f'{path.name}: row count differs between readers')
    for field in NUMERIC:
        data[field] = pd.to_numeric(data[field],errors='coerce').replace([float('inf'),float('-inf')],float('nan'))
    nulls = {c:int(data[c].isna().sum()) for c in NUMERIC if data[c].isna().any()}
    population = data[(data.active==1)&(data.found==1)&(data.async_mode==0)].copy()
    lead=(population.lead_x**2+population.lead_y**2)**.5
    def quantiles(s):
        vals=s.dropna()
        return {'n':int(len(vals)),'p50':float(vals.quantile(.5)), 'p95':float(vals.quantile(.95)), 'p99':float(vals.quantile(.99))} if len(vals) else {'n':0,'p50':None,'p95':None,'p99':None}
    image = population.image_ms.dropna()
    frame = population.frame_id.dropna()
    sent=population[(population.send_attempted==1)&(population.command_begin_ms>0)&(population.command_end_ms>=population.command_begin_ms)]
    command_elapsed=sent.command_end_ms-sent.command_begin_ms
    return {'file':path.name,'metadata':metadata,'rows':len(data),'active_found_sync_rows':len(population),
            'null_or_nonnumeric':nulls,'image_nonincreasing_pairs':int((image.diff().dropna()<=0).sum()),
            'frame_nonincreasing_pairs':int((frame.diff().dropna()<=0).sum()),
            'prediction_counts':{str(int(k)):int(v) for k,v in population.prediction_enabled.value_counts().items()},
            'result_age_ms':quantiles(population.result_age_ms[population.result_age_ms>=0]),
            'acquire_delay_ms':quantiles(population.acquire_delay_ms[population.acquire_delay_ms>=0]),
            'inference_ms':quantiles(population.inference_ms[population.inference_ms>=0]),
            'lead_magnitude_px':quantiles(lead),
            'lead_under_0_01px_count':int((lead<.01).sum()),
            'send_attempted_count':int((population.send_attempted==1).sum()),
            'send_host_call_ms':quantiles(command_elapsed),
            'px_per_count_values':sorted(float(x) for x in population.px_per_count.dropna().unique()),
            'checks':{'row_count_by_csv_reader':independent_count,
                      'active_found_sync_by_csv_reader':count_population(path)}}

def count_population(path):
    with path.open('r',encoding='utf-8-sig',newline='') as f:
        next(f)
        return sum(1 for r in csv.DictReader(f) if r.get('active')=='1' and r.get('found')=='1' and r.get('async_mode')=='0')

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('traces',nargs='+',type=Path);p.add_argument('--output',type=Path,required=True)
    args=p.parse_args()
    results=[summarize(path) for path in args.traces]
    for r in results:
        if r['active_found_sync_rows']!=r['checks']['active_found_sync_by_csv_reader']:
            raise ValueError('population count mismatch')
    payload={'plan':{'question':'Trace timing and lead diagnostics',
                     'grain':'one recorded detection/result row',
                     'population':'active=1, found=1, async_mode=0',
                     'units':'milliseconds and desktop pixels; negative timing sentinels excluded',
                     'limitations':'Separate runs, no ground-truth target or verified HID response. Percentiles do not establish end-to-end latency, accuracy, or causal improvements.'},
             'files':results}
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(payload,indent=2,ensure_ascii=False,allow_nan=False)+'\n',encoding='utf-8')
    print(f'Wrote {args.output}; {len(results)} file(s)')
if __name__=='__main__': main()
