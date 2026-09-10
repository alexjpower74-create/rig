// The rig follows the multiplexer it was started in. Inside herdr (HERDR_ENV=1) it drives herdr;
// anywhere else, tmux. A wrong pick is silent: `rig up` would create worktrees and briefs, then
// report "tmux not found" on a Mac with a herdr window full of agents — or the reverse. So both
// directions are checked, and each is broken by flipping the only thing the selection reads.

import { suite } from '../harness/check.js'

const setEnv = (v) => { if (v == null) delete process.env.HERDR_ENV; else process.env.HERDR_ENV = v }

await suite('terminal backend', async s => {
  const { terminal } = await import('../src/terminal.js')
  const { inspect } = await import('../src/blocked.js')

  setEnv('1')
  await s.check('inside herdr, auto picks the herdr driver', {
    assert: async () => terminal({ terminal: 'auto' }).name === 'herdr',
    breaks: async () => { setEnv(null); return () => setEnv('1') }
  })

  setEnv(null)
  await s.check('outside herdr, auto picks tmux', {
    assert: async () => terminal({ terminal: 'auto' }).name === 'tmux',
    breaks: async () => { setEnv('1'); return () => setEnv(null) }
  })

  // Explicit config beats the environment. Broken by removing the setting, at which point the
  // environment (herdr) decides — so the assert must go red.
  setEnv('1')
  const cfg = { terminal: 'tmux' }
  await s.check('an explicit "terminal" setting overrides the environment', {
    assert: async () => terminal(cfg).name === 'tmux',
    breaks: async () => { delete cfg.terminal; return () => { cfg.terminal = 'tmux' } }
  })

  // herdr's own verdict is trusted ahead of the text scan. The pane here does not exist, so there
  // is no prompt text to scrape; only the reported status can make this blocked. Broken by
  // reporting `unknown` instead, which must fall through to the (empty) scan and read as free.
  let status = 'blocked'
  await s.check('herdr-reported blocked state is trusted without prompt text on screen', {
    assert: async () => inspect('no-such-pane', status).blocked === true,
    breaks: async () => { status = 'unknown'; return () => { status = 'blocked' } }
  })

  let status2 = 'working'
  await s.check('herdr-reported working state suppresses a stale prompt in scrollback', {
    assert: async () => inspect('no-such-pane', status2).blocked === false,
    breaks: async () => { status2 = 'blocked'; return () => { status2 = 'working' } }
  })
  setEnv('1')
})
