# -*- mode: python ; coding: utf-8 -*-


a = Analysis(
    ['app.py'],
    pathex=['src'],
    binaries=[],
    datas=[('src/ui', 'ui')],
    hiddenimports=[
        'calcbc',
        'calcbc.app',
        'calcbc.graph',
        'calcbc.catalog',
        'calcbc.subjects',
        'calcbc.subjects.calculus',
        'calcbc.visualizers',
        'calcbc.visualizers.taylor',
        'calcbc.visualizers.riemann',
        'calcbc.visualizers.derivatives',
        'calcbc.visualizers.volume_rotation',
        'calcbc.visualizers.limit',
        'calcbc.visualizers.inverse',
        'calcbc.visualizers.parametric',
        'calcbc.visualizers.polar',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='CalcBCVisualizers',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='CalcBCVisualizers',
)
app = BUNDLE(
    coll,
    name='CalcBCVisualizers.app',
    icon=None,
    bundle_identifier=None,
)
