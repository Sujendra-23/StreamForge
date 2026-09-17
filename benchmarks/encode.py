#!/usr/bin/env python3
"""Reproducible, offline H.264 encoding throughput benchmark. No invented results."""
import argparse
import datetime
import json
import pathlib
import resource
import shutil
import subprocess
import sys
import time

parser = argparse.ArgumentParser()
parser.add_argument('--frames', type=int, default=300)
parser.add_argument('--encoder', choices=['x264', 'nvh264'], default='x264')
parser.add_argument('--output', default='benchmarks/results')
args = parser.parse_args()
if not 1 <= args.frames <= 100000:
    parser.error('--frames must be between 1 and 100000')
gst = shutil.which('gst-launch-1.0')
if not gst:
    raise SystemExit('Install GStreamer first; see README.md')
output = pathlib.Path(args.output)
output.mkdir(parents=True, exist_ok=True)
results = []
for width, height, fps in [(1280, 720, 30), (1920, 1080, 30), (1920, 1080, 60)]:
    target = output / f'{args.encoder}-{width}x{height}-{fps}.h264'
    encoder = ['x264enc', 'tune=zerolatency', 'speed-preset=veryfast', 'bitrate=5000'] if args.encoder == 'x264' else ['nvh264enc', 'bitrate=5000']
    command = [gst, '-q', '-e', 'videotestsrc', f'num-buffers={args.frames}', 'pattern=smpte', '!', f'video/x-raw,width={width},height={height},framerate={fps}/1,format=I420', '!', *encoder, '!', 'h264parse', '!', 'video/x-h264,stream-format=byte-stream', '!', 'filesink', f'location={target}']
    before = resource.getrusage(resource.RUSAGE_CHILDREN)
    start = time.perf_counter()
    result = subprocess.run(command, capture_output=True, text=True)
    elapsed = time.perf_counter() - start
    after = resource.getrusage(resource.RUSAGE_CHILDREN)
    if result.returncode:
        raise SystemExit(f'Pipeline failed (encoder may be unavailable):\n{result.stderr}')
    cpu = after.ru_utime + after.ru_stime - before.ru_utime - before.ru_stime
    entry = {'encoder': args.encoder, 'width': width, 'height': height, 'source_fps': fps, 'frames': args.frames, 'wall_seconds': round(elapsed, 3), 'throughput_fps': round(args.frames / elapsed, 2), 'cpu_seconds': round(cpu, 3), 'output_bytes': target.stat().st_size, 'output_bitrate_mbps': round(target.stat().st_size * 8 / (args.frames / fps) / 1e6, 3)}
    results.append(entry)
    print(json.dumps(entry))
report = {'measured_at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'platform': sys.platform, 'gst_version': subprocess.check_output([gst, '--version'], text=True).strip(), 'note': 'Offline pipeline throughput including startup, not per-frame encoding latency. Test pattern: SMPTE. Compare encoders with identical frame counts, sources, and presets.', 'results': results}
path = output / f'{args.encoder}-report.json'
path.write_text(json.dumps(report, indent=2) + '\n')
print(f'Report written to {path}')
