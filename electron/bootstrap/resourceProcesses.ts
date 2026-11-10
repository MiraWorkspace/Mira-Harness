import { execFile } from 'node:child_process'
import { basename } from 'node:path'
import os from 'node:os'

export interface NativeResourceProcess { pid: number; parentPid: number; name: string; memoryBytes: number; cpuMs: number }

export function parseResourceProcesses(output: string, platform: NodeJS.Platform): NativeResourceProcess[] {
  if (platform === 'win32') {
    const parsed = JSON.parse(output.replace(/^\uFEFF/, ''))
    return (Array.isArray(parsed) ? parsed : [parsed]).filter(Boolean).map(row => ({
      pid: Number(row.ProcessId), parentPid: Number(row.ParentProcessId), name: String(row.Name),
      memoryBytes: Number(row.WorkingSetSize), cpuMs: (Number(row.KernelModeTime) + Number(row.UserModeTime)) / 10000,
    }))
  }
  return output.split('\n').flatMap(line => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+([\d.:\-]+)\s+(\d+)\s+(.+)$/)
    if (!match) return []
    const [, pid, parentPid, time, rss, command] = match
    const [days, clock] = time.includes('-') ? time.split('-') : ['0', time]
    const seconds = clock.split(':').reduce((sum, part) => sum * 60 + Number(part), 0) + Number(days) * 86400
    return [{ pid: Number(pid), parentPid: Number(parentPid), name: basename(command), memoryBytes: Number(rss) * 1024, cpuMs: seconds * 1000 }]
  })
}

export function descendantProcesses(rows: NativeResourceProcess[], rootPid: number, excludedPid?: number) {
  const included = new Set([rootPid]), excluded = new Set(excludedPid ? [excludedPid] : [])
  // Expand both trees before filtering so the sampler never reports itself or its helpers.
  for (let changed = true; changed;) {
    changed = false
    for (const row of rows) {
      if (included.has(row.parentPid) && !included.has(row.pid)) { included.add(row.pid); changed = true }
      if (excluded.has(row.parentPid) && !excluded.has(row.pid)) { excluded.add(row.pid); changed = true }
    }
  }
  return rows.filter(row => row.pid !== rootPid && included.has(row.pid) && !excluded.has(row.pid))
}

/** Child processes are absent from Electron's app metrics. Never expose their command arguments. */
export function createChildResourceSampler() {
  let previous = new Map<number, { cpuMs: number; at: number }>()
  return {
    reset() { previous.clear() },
    async sample() {
      const platform = process.platform
      const command = platform === 'win32' ? 'powershell.exe' : '/bin/ps'
      const args = platform === 'win32'
        ? ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,WorkingSetSize,KernelModeTime,UserModeTime | ConvertTo-Json -Compress']
        : ['-axo', 'pid=,ppid=,time=,rss=,comm=']
      const { output, samplerPid } = await new Promise<{ output: string; samplerPid?: number }>((resolve, reject) => {
        const child = execFile(command, args, { windowsHide: true, timeout: 5000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C' } }, (error, output) => {
          if (error) reject(error)
          else resolve({ output, samplerPid: child.pid })
        })
      })
      const at = performance.now(), next = new Map<number, { cpuMs: number; at: number }>()
      const rows = descendantProcesses(parseResourceProcesses(output, platform), process.pid, samplerPid).map(row => {
        const baseline = previous.get(row.pid)
        next.set(row.pid, { cpuMs: row.cpuMs, at })
        const cpuPercent = baseline && at > baseline.at && row.cpuMs >= baseline.cpuMs
          ? Math.max(0, Math.min(100, (row.cpuMs - baseline.cpuMs) / (at - baseline.at) / Math.max(1, os.cpus().length) * 100)) : null
        return { ...row, cpuPercent }
      })
      previous = next
      return rows
    },
  }
}
