#!/usr/bin/env python3
"""Build and run the platform-independent regression tests with C++20."""
import argparse
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--compiler', default=os.environ.get('CXX'))
    args = parser.parse_args()
    compiler = shlex.split(args.compiler) if args.compiler else []
    if not compiler:
        compiler = [next((c for c in ('cl', 'g++', 'clang++') if shutil.which(c)), '')]
    if not compiler[0] or not shutil.which(compiler[0]):
        parser.error('A C++20 compiler is required; set CXX or use --compiler.')
    root = Path(__file__).resolve().parent.parent
    sources = sorted((root / 'tests').glob('*_tests.cpp'))
    if not sources:
        parser.error('No portable tests found.')
    msvc = Path(compiler[0]).stem.lower() in ('cl', 'clang-cl')
    with tempfile.TemporaryDirectory(prefix='albion-tests-') as directory:
        work = Path(directory)
        for source in sources:
            executable = work / (source.stem + ('.exe' if os.name == 'nt' else ''))
            if msvc:
                command = compiler + ['/nologo', '/std:c++20', '/EHsc', '/W4',
                    '/utf-8', '/I' + str(root), str(source), '/Fe:' + str(executable)]
            else:
                command = compiler + ['-std=c++20', '-Wall', '-Wextra', '-Werror',
                    '-pthread', '-I', str(root), str(source), '-o', str(executable)]
            print('Building ' + source.name, flush=True)
            subprocess.run(command, cwd=work, check=True)
            subprocess.run([str(executable)], cwd=work, check=True)
    print(f'PASS: {len(sources)} portable regression executables')


if __name__ == '__main__':
    main()
