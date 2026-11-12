#!/usr/bin/env python3
"""Compare user-collected F9 logs, not synthetic GPU performance estimates."""
import argparse,json,re,statistics
from pathlib import Path
FIELDS={
 'backend_ms':r'^Inference/backend ms: ([0-9.]+)',
 'decode_ms':r'^Decode/NMS ms: ([0-9.]+)',
 'capture_to_result_ms':r'^Capture-to-result ms: ([0-9.]+)',
 'result_age_ms':r'^Latest result age ms: ([0-9.]+)',
 'delivery_ms':r'^Result delivery ms: ([0-9.]+)',
 'inference_fps':r'^Completed inference FPS \(since previous F9/start\): ([0-9.]+)',
 'capture_fps':r'^Capture FPS: ([0-9.]+)',
 'rolling_p95_ms':r'^Capture-to-result p50/p95 ms \([^\n]+\): [0-9.]+ / ([0-9.]+)'}
def summarize(text,skip):
 blocks=re.split(r'(?=^\[\d{4}-\d\d-\d\d [^\n]+\] F9 snapshot)',text,flags=re.M)
 blocks=[b for b in blocks if re.match(r'^\[\d{4}-',b)]
 selected=[b for b in blocks[skip:] if 'Detector ready: false' not in b]
 metrics={}
 for key,pattern in FIELDS.items():
  values=[float(m.group(1))for b in selected if (m:=re.search(pattern,b,re.M))]
  if values:metrics[key]={'samples':len(values),'median':statistics.median(values),'min':min(values),'max':max(values)}
 sources=sorted({m.group(1)for b in selected if(m:=re.search(r'^Capture source: (.+)',b,re.M))})
 return {'snapshots_total':len(blocks),'snapshots_after_warmup_and_ready_filter':len(selected),'capture_sources':sources,'metrics':metrics}
def compare(a,b):
 result={}
 for k in a['metrics'].keys()&b['metrics'].keys():
  old=a['metrics'][k]['median'];new=b['metrics'][k]['median']
  result[k]={'baseline_median':old,'candidate_median':new,'change_percent':(new/old-1)*100 if old else None,'lower_is_better':not k.endswith('_fps')}
 return result
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('baseline');p.add_argument('candidate');p.add_argument('--skip',type=int,default=2);p.add_argument('--output');args=p.parse_args()
 if args.skip<0:p.error('--skip must be nonnegative')
 a=summarize(Path(args.baseline).read_text(encoding='utf-8-sig'),args.skip);b=summarize(Path(args.candidate).read_text(encoding='utf-8-sig'),args.skip)
 result={'baseline':a,'candidate':b,'comparison':compare(a,b),'warning':'Medians of F9 snapshots, not continuous GPU traces or statistical proof. rolling_p95_ms is median of overlapping rolling-window p95s, not global p95. Capture FPS stages differ: WGC consumer-accepted vs DXGI acquired; do not interpret capture_fps delta as a speedup. Match model, scene, power state, FPS limits and profiling flags.'}
 text=json.dumps(result,indent=2,ensure_ascii=False);print(text)
 if args.output:Path(args.output).write_text(text,encoding='utf-8')
 if not a['metrics'] or not b['metrics']:raise SystemExit('Insufficient comparable snapshots')
