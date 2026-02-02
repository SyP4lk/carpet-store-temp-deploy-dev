import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { z } from 'zod'
import { spawn } from 'node:child_process'
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

const BodySchema = z.object({
  mode: z.enum(['translate', 'copy_en']).default('translate'),
  translateDescriptions: z.boolean().default(true),
  translateTechnicalDetails: z.boolean().default(true),
  translateLists: z.boolean().default(true),
  translateTaxonomy: z.boolean().default(false),
})

export async function POST(req: Request) {
  const session = await requireAdmin()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const json = await req.json().catch(() => ({}))
  const body = BodySchema.parse(json)

  const logsDir = path.join(process.cwd(), 'logs')
  fs.mkdirSync(logsDir, { recursive: true })
  const fileName = `bmhome-translate-ru_${new Date().toISOString().replace(/[:.]/g, '-')}.log`
  const logFile = path.join(logsDir, fileName)

  const out = fs.openSync(logFile, 'a')
  const err = fs.openSync(logFile, 'a')

  const env = {
    ...process.env,
    BMHOME_TRANSLATE_MODE: body.mode,
    BMHOME_TRANSLATE_DESC: body.translateDescriptions ? '1' : '0',
    BMHOME_TRANSLATE_TECH: body.translateTechnicalDetails ? '1' : '0',
    BMHOME_TRANSLATE_LISTS: body.translateLists ? '1' : '0',
    BMHOME_TRANSLATE_TAXONOMY: body.translateTaxonomy ? '1' : '0',
  }

  const command = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const child = spawn(command, ['run', 'bmhome:translate-ru'], {
    cwd: process.cwd(),
    env,
    detached: true,
    stdio: ['ignore', out, err],
  })

  child.unref()

  return NextResponse.json({
    success: true,
    message: 'BMHOME RU translate started',
    logFile: path.join('logs', fileName),
  })
}
