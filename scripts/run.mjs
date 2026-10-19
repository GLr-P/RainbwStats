// VS Code terminals export ELECTRON_RUN_AS_NODE=1, which turns Electron into plain Node.
// Strip it and forward everything else: `node scripts/run.mjs <bin> [...args]`.
import { spawn } from 'node:child_process'

delete process.env.ELECTRON_RUN_AS_NODE
const [bin, ...args] = process.argv.slice(2)
const child = spawn(bin, args, { stdio: 'inherit', shell: true })
child.on('exit', (code) => process.exit(code ?? 1))
