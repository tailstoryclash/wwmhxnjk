# compare_backends.py
"""Synthetic CPU-I/O backend comparison; not model mAP or application FPS."""
import argparse
import ctypes
import hashlib
import json
import os
from pathlib import Path
import time
import numpy as np
import onnxruntime as ort


def distribution(samples):
    return dict(count=len(samples),mean_ms=float(np.mean(samples)),max_ms=max(samples),
                p50_ms=float(np.quantile(samples,.5)),p95_ms=float(np.quantile(samples,.95)),p99_ms=float(np.quantile(samples,.99)))


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--onnx',type=Path,required=True)
    parser.add_argument('--engine',type=Path)
    parser.add_argument('--output',type=Path,required=True)
    arguments=parser.parse_args()
    if arguments.output.exists():
        raise FileExistsError(arguments.output)
    dll_directories=[]
    if os.name=='nt':
        for folder in (r'C:\TensorRT-10.11.0.33\lib',r'C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v11.8\bin'):
            if Path(folder).is_dir():dll_directories.append(os.add_dll_directory(folder))
    summary=dict(scope='Python wrappers, identical FP32 CPU-resident inputs and CPU-visible outputs; no preprocess/capture/decode',
                 ort_version=ort.__version__,available_providers=ort.get_available_providers(),
                 onnx_sha256=hashlib.sha256(arguments.onnx.read_bytes()).hexdigest(),raw_samples_ms={})
    options=ort.SessionOptions();options.intra_op_num_threads=1;options.inter_op_num_threads=1
    options.graph_optimization_level=ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    began=time.perf_counter();session=ort.InferenceSession(str(arguments.onnx),sess_options=options,providers=['CPUExecutionProvider'])
    summary['ort_initialization_ms']=(time.perf_counter()-began)*1000
    inputs=session.get_inputs();outputs=session.get_outputs()
    if len(inputs)!=1 or len(outputs)!=1 or inputs[0].shape!=[1,3,256,256] or inputs[0].type!='tensor(float)':
        raise ValueError('This fixture requires the inspected single FP32 [1,3,256,256] model')
    tensor=np.random.default_rng(721).random((1,3,256,256),dtype=np.float32)
    began=time.perf_counter();reference=session.run(None,{inputs[0].name:tensor})[0]
    summary['ort_first_run_ms']=(time.perf_counter()-began)*1000
    if reference.shape!=(1,8,1344) or not np.isfinite(reference).all():
        raise ValueError('Invalid reference output')
    for _ in range(20):session.run(None,{inputs[0].name:tensor})
    samples=[]
    for _ in range(100):
        began=time.perf_counter();session.run(None,{inputs[0].name:tensor});samples.append((time.perf_counter()-began)*1000)
    summary['ort_cpu']=distribution(samples);summary['raw_samples_ms']['ort_cpu']=samples
    summary['selected_backend']='CPUExecutionProvider'
    if arguments.engine:
        try:
            import tensorrt as trt
            summary['trt_version']=trt.__version__
            summary['engine_sha256']=hashlib.sha256(arguments.engine.read_bytes()).hexdigest()
            cuda=ctypes.CDLL('cudart64_110.dll')
            pointer=ctypes.c_void_p
            cuda.cudaMalloc.argtypes=[ctypes.POINTER(pointer),ctypes.c_size_t]
            cuda.cudaFree.argtypes=[pointer]
            cuda.cudaStreamCreate.argtypes=[ctypes.POINTER(pointer)]
            cuda.cudaStreamDestroy.argtypes=[pointer]
            cuda.cudaStreamSynchronize.argtypes=[pointer]
            cuda.cudaMemcpyAsync.argtypes=[pointer,pointer,ctypes.c_size_t,ctypes.c_int,pointer]
            def check(status):
                if status:raise RuntimeError('CUDA runtime status '+str(status))
            began=time.perf_counter();logger=trt.Logger(trt.Logger.WARNING);runtime=trt.Runtime(logger)
            engine=runtime.deserialize_cuda_engine(arguments.engine.read_bytes())
            if engine is None:raise RuntimeError('TensorRT engine deserialization failed')
            context=engine.create_execution_context()
            names=[engine.get_tensor_name(index) for index in range(engine.num_io_tensors)]
            in_names=[name for name in names if engine.get_tensor_mode(name)==trt.TensorIOMode.INPUT]
            out_names=[name for name in names if engine.get_tensor_mode(name)==trt.TensorIOMode.OUTPUT]
            if len(in_names)!=1 or len(out_names)!=1:raise ValueError('Expected exactly one input and output')
            in_name,out_name=in_names[0],out_names[0]
            if tuple(engine.get_tensor_shape(in_name))!=tensor.shape or tuple(engine.get_tensor_shape(out_name))!=reference.shape:
                raise ValueError('Engine IO shape mismatch')
            if engine.get_tensor_dtype(in_name)!=trt.float32 or engine.get_tensor_dtype(out_name)!=trt.float32:
                raise ValueError('Engine IO must be FP32; internal precision is not inferred from filename')
            input_device,output_device,stream=pointer(),pointer(),pointer()
            result=np.empty_like(reference)
            try:
                check(cuda.cudaMalloc(ctypes.byref(input_device),tensor.nbytes));check(cuda.cudaMalloc(ctypes.byref(output_device),result.nbytes));check(cuda.cudaStreamCreate(ctypes.byref(stream)))
                if not context.set_tensor_address(in_name,input_device.value) or not context.set_tensor_address(out_name,output_device.value):
                    raise RuntimeError('Setting tensor addresses failed')
                summary['trt_initialization_ms']=(time.perf_counter()-began)*1000
                def execute():
                    check(cuda.cudaMemcpyAsync(input_device,tensor.ctypes.data,tensor.nbytes,1,stream))
                    if not context.execute_async_v3(stream_handle=stream.value):raise RuntimeError('TensorRT execution failed')
                    check(cuda.cudaMemcpyAsync(result.ctypes.data,output_device,result.nbytes,2,stream));check(cuda.cudaStreamSynchronize(stream))
                began=time.perf_counter();execute();summary['trt_first_run_ms']=(time.perf_counter()-began)*1000
                errors=[]
                for pattern in range(8):
                    tensor.fill(pattern/8) if pattern<4 else tensor.__setitem__(slice(None),np.random.default_rng(721+pattern).random(tensor.shape,dtype=np.float32))
                    expected=session.run(None,{inputs[0].name:tensor})[0];execute()
                    if not np.isfinite(result).all():raise ArithmeticError('Nonfinite TensorRT output')
                    residual=np.abs(result-expected)
                    errors.append(dict(pattern=pattern,max_abs=float(residual.max()),coordinate_max_abs=float(residual[:,:4].max()),score_max_abs=float(residual[:,4:].max()),mean_abs=float(residual.mean())))
                summary['synthetic_onnx_trt_differences']=errors
                np.copyto(tensor,np.random.default_rng(721).random(tensor.shape,dtype=np.float32))
                for _ in range(20):execute()
                samples=[]
                for _ in range(100):
                    began=time.perf_counter();execute();samples.append((time.perf_counter()-began)*1000)
                summary['trt_cpu_io']=distribution(samples);summary['raw_samples_ms']['trt_cpu_io']=samples
                summary['selected_backend']='TensorRT' if summary['trt_cpu_io']['p95_ms']<summary['ort_cpu']['p95_ms'] else 'CPUExecutionProvider'
                summary['selection_scope']='This standalone synthetic fixture only; production backend selection is unchanged'
            finally:
                if stream.value:check(cuda.cudaStreamSynchronize(stream))
                context=None
                if stream.value:check(cuda.cudaStreamDestroy(stream))
                if output_device.value:check(cuda.cudaFree(output_device))
                if input_device.value:check(cuda.cudaFree(input_device))
        except Exception as error:
            summary['trt_error']=str(error)
            summary['selected_backend']='CPUExecutionProvider'
            summary['fallback_scope']='This offline diagnostic only, not a new GUI fallback'
    arguments.output.write_text(json.dumps(summary,indent=2,allow_nan=False))
    print(json.dumps({key:value for key,value in summary.items() if key not in ('raw_samples_ms','synthetic_onnx_trt_differences')}))


if __name__=='__main__':
    main()
