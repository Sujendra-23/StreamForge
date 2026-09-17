"""Build the LGPL libnice ICE plugin locally; no system library modifications."""
import hashlib
import pathlib
import shlex
import subprocess
import tarfile
import urllib.request

root = pathlib.Path(__file__).resolve().parent.parent
build = root / 'media-engine' / 'build'
deps = build / 'deps'
deps.mkdir(parents=True, exist_ok=True)
archive = deps / 'libnice.tar.gz'
url = 'https://libnice.freedesktop.org/releases/libnice-0.1.24.tar.gz'
expected = 'cfb5e8e778534f2f5b3c6f4958a1eb057c6b95c537c0f100817a537cf5d64fcc'
if not archive.exists():
    urllib.request.urlretrieve(url, archive)
if hashlib.sha256(archive.read_bytes()).hexdigest() != expected:
    raise SystemExit('libnice source checksum mismatch; remove build/deps/libnice.tar.gz and retry')
with tarfile.open(archive) as source:
    source.extractall(deps, filter='data')
plugin = build / 'plugins'
plugin.mkdir(exist_ok=True)
flags = shlex.split(subprocess.check_output(['pkg-config', '--cflags', '--libs', 'nice', 'gstreamer-1.0', 'gstreamer-base-1.0', 'gstreamer-net-1.0'], text=True))
flags.append('-I' + subprocess.check_output(['pkg-config', '--variable=includedir', 'nice'], text=True).strip())
source = deps / 'libnice-0.1.24' / 'gst'
suffix = '.dylib' if __import__('sys').platform == 'darwin' else '.so'
subprocess.run(['cc', '-shared', '-fPIC', '-O2', '-DGST_USE_UNSTABLE_API', '-DVERSION="0.1.24"', '-DPACKAGE="libnice"', '-DPACKAGE_NAME="libnice"', *[str(source / f) for f in ['gstnice.c', 'gstnicesrc.c', 'gstnicesink.c']], *flags, '-o', str(plugin / ('libgstnice' + suffix))], check=True)
print(f'Built ICE plugin: {plugin}')
