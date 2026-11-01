# Binding whitelist for the Virtual Tailor OpenCV.js build (docs/opencv-build.md).
# Only what marker.worker needs: ArUco detection. Mat and its helpers are always bound.
aruco = {
    "": ["getPredefinedDictionary"],
    "aruco_PredefinedDictionaryType": [],
    "aruco_Dictionary": ["Dictionary"],
    "aruco_DetectorParameters": ["DetectorParameters"],
    "aruco_RefineParameters": ["RefineParameters"],
    "aruco_ArucoDetector": ["ArucoDetector", "detectMarkers"],
}

# ArucoDetector's base class must be bound, or constructing it throws UnboundTypeError.
core = {"Algorithm": []}

white_list = makeWhiteList([core, aruco])  # noqa: F821 (defined by OpenCV's build script)
