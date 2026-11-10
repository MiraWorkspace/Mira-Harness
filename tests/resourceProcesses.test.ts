import { expect, it } from 'vitest'
import { descendantProcesses, parseResourceProcesses } from '../electron/bootstrap/resourceProcesses'

it('reads macOS/Linux CPU time and RSS, and Windows 100ns CPU counters and bytes', () => {
  expect(parseResourceProcesses('21 1 1-02:03:04.50 2048 /path with spaces/python\n22 21 0:01.25 10 node\n', 'darwin')).toEqual([
    { pid: 21, parentPid: 1, name: 'python', cpuMs: 93784500, memoryBytes: 2097152 },
    { pid: 22, parentPid: 21, name: 'node', cpuMs: 1250, memoryBytes: 10240 },
  ])
  expect(parseResourceProcesses('\uFEFF{"ProcessId":21,"ParentProcessId":1,"Name":"python.exe","WorkingSetSize":"2048","KernelModeTime":"10000000","UserModeTime":"2500000"}', 'win32')).toEqual([
    { pid: 21, parentPid: 1, name: 'python.exe', memoryBytes: 2048, cpuMs: 1250 },
  ])
})

it('finds out-of-order descendant trees without including unrelated apps or the sampling process tree', () => {
  const rows = [[24, 23], [41, 40], [23, 20], [20, 10], [40, 10], [99, 1]].map(([pid, parentPid]) => ({ pid, parentPid, name: 'node', memoryBytes: 1, cpuMs: 1 }))
  expect(descendantProcesses(rows, 10, 40).map(row => row.pid)).toEqual([24, 23, 20])
})
