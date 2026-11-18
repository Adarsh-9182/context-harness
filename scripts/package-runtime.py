"""Package only distributable app source; never include credentials or runtime state."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
target = root / 'dist' / 'downloads' / 'harness-studio.zip'
target.parent.mkdir(parents=True, exist_ok=True)
files = ['package.json', 'package-lock.json', 'README.md', '.gitignore', '.env.example',
         'AGENTS.md', 'server.mjs', 'next.config.ts', 'tsconfig.json',
         'postcss.config.mjs', 'vitest.config.ts', 'playwright.config.ts',
         'Dockerfile', 'compose.yaml', 'compose.ci.yaml', '.dockerignore']
for directory in ['src', 'docs', 'tests', 'scripts', 'web', 'public', '.github', 'dist']:
    for path in sorted((root / directory).rglob('*')):
        if path.is_file() and 'downloads' not in path.parts:
            files.append(str(path.relative_to(root)))
with ZipFile(target, 'w', compression=ZIP_DEFLATED) as archive:
    for name in files:
        path = root / name
        if not path.is_file() or path.is_symlink():
            raise RuntimeError(f'Missing or unsafe release input: {name}')
        archive.write(path, 'harness-studio/' + name)
print(f'Packaged {len(files)} source files into {target.relative_to(root)}')
