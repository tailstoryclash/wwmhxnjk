#!/usr/bin/env python3
"""Estimate a scalar tracking scale from measured, isolated static-target pulses.

Inputs are JSON files with x/y arrays of objects {"counts": ..., "delta_px": ...}.
Both files must have >=5 valid pulses per axis. Run only after motion has settled;
physical mouse movement, moving targets, acceleration and unaccounted commands
invalidate the measurements. This utility never moves the mouse or edits configs.
"""
import argparse
import json
import math
import statistics
from pathlib import Path

MIN_COUNT = 4.0
MIN_PIXEL = 1.0
MAX_MEASUREMENT = 1_000_000.0
MAX_REL_MAD = 0.20
MAX_AXIS_RATIO_DIFFERENCE = 0.10

def measure(data, axis):
    entries=data.get(axis)
    if not isinstance(entries,list) or len(entries)<5:
        raise ValueError(f'{axis}: at least five isolated pulses required')
    ratios=[]
    for row in entries:
        if not isinstance(row,dict): raise ValueError(f'{axis}: expected pulse object')
        try:
            if isinstance(row['counts'],bool) or isinstance(row['delta_px'],bool): raise ValueError()
            counts=float(row['counts']); delta=float(row['delta_px'])
        except (KeyError,ValueError,TypeError,OverflowError):
            raise ValueError(f'{axis}: invalid counts or delta_px') from None
        if not math.isfinite(counts) or not math.isfinite(delta):
            raise ValueError(f'{axis}: nonfinite measurement')
        if abs(counts)>MAX_MEASUREMENT or abs(delta)>MAX_MEASUREMENT:
            raise ValueError(f'{axis}: measurement exceeds supported bounds')
        if abs(counts)<MIN_COUNT or abs(delta)<MIN_PIXEL:
            raise ValueError(f'{axis}: pulse too small for reliable measurement')
        ratios.append(delta/counts)
    sign=1 if statistics.median(ratios)>0 else -1
    if any(r*sign<=0 for r in ratios):
        raise ValueError(f'{axis}: inconsistent displacement direction')
    magnitudes=[abs(r) for r in ratios]
    med=statistics.median(magnitudes)
    mad=statistics.median(abs(v-med) for v in magnitudes)
    rel_mad=mad/med
    return {'pulses':len(ratios),'sign':sign,'px_per_count':med,
            'relative_mad':rel_mad,'relative_span':(max(magnitudes)-min(magnitudes))/med,
            'range_px_per_count':[min(magnitudes),max(magnitudes)]}

def evaluate(reference,current,reference_scale):
    if not math.isfinite(reference_scale) or not (0.05<=reference_scale<=2.0):
        raise ValueError('reference scale must be in [0.05, 2.0]')
    out={'reference_scale':reference_scale,'axes':{},'suggested_scale':None,'warnings':[]}
    factors=[]
    for axis in ('x','y'):
        before=measure(reference,axis); after=measure(current,axis)
        if before['sign']!=after['sign']: raise ValueError(f'{axis}: direction changed between measurements')
        ratio=before['px_per_count']/after['px_per_count']
        out['axes'][axis]={'reference':before,'current':after,'suggested_factor':ratio}
        factors.append(ratio)
        if (before['relative_mad']>MAX_REL_MAD or after['relative_mad']>MAX_REL_MAD or
            before['relative_span']>.5 or after['relative_span']>.5):
            out['warnings'].append(f'{axis}: dispersion too high for an automatic suggestion')
    deviation=abs(factors[0]-factors[1])/max(factors)
    out['axis_factor_relative_difference']=deviation
    if deviation>MAX_AXIS_RATIO_DIFFERENCE:
        out['warnings'].append('x/y scale factors differ by over 10%; one scalar is not appropriate')
    factor=math.sqrt(factors[0]*factors[1]); proposed=reference_scale*factor
    out['unclamped_scale']=proposed
    if not (0.05<=proposed<=2.0):out['warnings'].append('proposed scale is outside the controller range [0.05, 2.0]')
    if not out['warnings']:out['suggested_scale']=proposed
    out['limitations']=['Static target, isolated pulses, stable view and no physical input are prerequisites.',
        'Not valid across zoom/FOV, DPI or acceleration changes unless separately measured.',
        'Quantization, delay, nonlinear sensitivity and in-game changes are not modeled.',
        'This tool does not apply settings and does not verify HID delivery.']
    return out

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('reference',type=Path);p.add_argument('current',type=Path)
    p.add_argument('--reference-scale',required=True,type=float);p.add_argument('--output',required=True,type=Path)
    args=p.parse_args()
    try:
        ref=json.loads(args.reference.read_text(encoding='utf-8-sig'))
        cur=json.loads(args.current.read_text(encoding='utf-8-sig'))
        if not isinstance(ref,dict) or not isinstance(cur,dict):raise ValueError('root must be an object')
        result=evaluate(ref,cur,args.reference_scale)
        args.output.parent.mkdir(parents=True,exist_ok=True)
        with args.output.open('x',encoding='utf-8') as handle:
            handle.write(json.dumps(result,indent=2,allow_nan=False)+'\n')
        print(f'Wrote {args.output}; suggested scale: {result["suggested_scale"]}')
    except (ValueError,OSError,json.JSONDecodeError) as e:
        p.exit(2,f'Calibration failed: {e}\n')
if __name__=='__main__':main()
