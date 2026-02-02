import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import fs from 'node:fs'
import path from 'node:path'

export const runtime = 'nodejs'

async function requireAdmin() {
  const session = await getServerSession(authOptions)
  if (!session?.user || (session.user.role !== 'ADMIN' && session.user.role !== 'SUPER_ADMIN')) {
    return null
  }
  return session
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function readLogTail(filePath: string, maxLines = 20): string {
  if (!fs.existsSync(filePath)) return ''
  const raw = fs.readFileSync(filePath, 'utf8')
  const lines = raw.split(/\r?\n/).filter(Boolean)
  return lines.slice(-maxLines).join('\n')
}

function parseProgress(logTail: string) {
  let total = 0
  let done = 0
  let stage = ''
  const lines = logTail.split(/\r?\n/)
  for (const line of lines) {
    const totalMatch = line.match(/TOTAL=(\d+)/)
    if (totalMatch) total = Number(totalMatch[1])
    const progressMatch = line.match(/PROGRESS\s+done=(\d+)\s+total=(\d+)(?:\s+stage="([^"]+)")?/)
    if (progressMatch) {
      done = Number(progressMatch[1])
      total = Number(progressMatch[2])
      stage = progressMatch[3] || stage
    }
  }
  return { done, total, stage }
}

export async function GET(req: Request) {
  const session = await requireAdmin()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const jobId = searchParams.get('jobId')?.trim()
  if (!jobId) {
    return NextResponse.json({ error: 'Missing jobId' }, { status: 400 })
  }

  const logsDir = path.join(process.cwd(), 'logs')
  const logFile = path.join(logsDir, `${jobId}.log`)
  const pidFile = path.join(logsDir, `${jobId}.pid`)

  let running = false
  if (fs.existsSync(pidFile)) {
    const pidRaw = fs.readFileSync(pidFile, 'utf8').trim()
    const pid = Number(pidRaw)
    if (Number.isFinite(pid) && pid > 0) {
      running = isProcessRunning(pid)
    }
  }

  const logTail = readLogTail(logFile, 20)
  const progress = parseProgress(logTail)

  const response = NextResponse.json({
    running,
    progress: { done: progress.done, total: progress.total },
    stage: progress.stage || (running ? 'running' : 'stopped'),
    logTail,
  })
  response.headers.set('Cache-Control', 'no-store')
  return response
}
