# -*- mode: python ; coding: utf-8 -*-
import sys

hiddenimports = [
    "calcbc",
    "calcbc.app",
    "calcbc.graph",
    "calcbc.catalog",
    "calcbc.runtime",
    "calcbc.update",
    "certifi",
    "calcbc.subjects",
    "calcbc.subjects.calculus",
    "calcbc.subjects.fun",
    "calcbc.visualizers",
    "calcbc.visualizers.taylor",
    "calcbc.visualizers.riemann",
    "calcbc.visualizers.arc_length",
    "calcbc.visualizers.slope_field",
    "calcbc.visualizers.derivatives",
    "calcbc.visualizers.volume_rotation",
    "calcbc.visualizers.limit",
    "calcbc.visualizers.inverse",
    "calcbc.visualizers.parametric",
    "calcbc.visualizers.polar",
    "calcbc.visualizers.fourier",
    "calcbc.visualizers.monte_carlo",
]

a = Analysis(
    ["app.py"],
    pathex=["src"],
    binaries=[],
    datas=[("src/ui", "ui")],
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

ICON_ICNS = "branding/app-icon.icns"
ICON_ICO = "branding/app-icon.ico"

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="CalcBCVisualizers",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=ICON_ICO if sys.platform == "win32" else None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="CalcBCVisualizers",
)

if sys.platform == "darwin":
    app = BUNDLE(
        coll,
        name="CalcBCVisualizers.app",
        icon=ICON_ICNS,
        bundle_identifier="com.knivier.conceptvisualizers",
        info_plist={
            "CFBundleName": "Concept Visualizers",
            "CFBundleDisplayName": "Concept Visualizers",
            "CFBundleShortVersionString": "1.3",
            "CFBundleVersion": "1.3",
            "NSHighResolutionCapable": True,
            "LSMinimumSystemVersion": "12.0",
        },
    )
