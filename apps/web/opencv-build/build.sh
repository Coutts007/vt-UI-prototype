#!/bin/sh
# Rebuilds apps/web/public/opencv/opencv.js from official sources. See docs/opencv-build.md.
# usage: build.sh <work dir>  (needs docker; about 10 minutes)
set -eu
OPENCV=4.10.0
OPENCV_SHA256=b2171af5be6b26f7a06b1229948bbb2bdaa74fcf5cd097e0af6378fce50a6eb9
EMSDK=emscripten/emsdk:3.1.74
HERE=$(cd "$(dirname "$0")" && pwd)
WORK=$1
mkdir -p "$WORK"
cd "$WORK"
[ -f opencv-$OPENCV.tar.gz ] || curl -sSfL -o opencv-$OPENCV.tar.gz https://github.com/opencv/opencv/archive/refs/tags/$OPENCV.tar.gz
echo "$OPENCV_SHA256  opencv-$OPENCV.tar.gz" | sha256sum -c -
[ -d opencv-$OPENCV ] || tar xzf opencv-$OPENCV.tar.gz
cp "$HERE/opencv_js.config.py" vt_opencv_js.config.py
docker run --rm -v "$WORK:/src" -u "$(id -u):$(id -g)" "$EMSDK" \
  emcmake python3 opencv-$OPENCV/platforms/js/build_js.py build_vt \
  --build_wasm --simd --config /src/vt_opencv_js.config.py \
  --build_flags="-Oz -s ENVIRONMENT=web,worker,node " \
  --cmake_option=-DBUILD_opencv_dnn=OFF --cmake_option=-DBUILD_opencv_photo=OFF \
  --cmake_option=-DBUILD_opencv_video=OFF --cmake_option=-DBUILD_opencv_gapi=OFF \
  --cmake_option=-DBUILD_opencv_highgui=OFF --cmake_option=-DBUILD_opencv_imgcodecs=OFF
ls -l build_vt/bin/opencv.js
sha256sum build_vt/bin/opencv.js
