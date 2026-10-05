import type { Transporter } from 'nodemailer'

export type Mail = { to: string; subject: string; text: string; html: string; replyTo?: string }
export type Send = (mail: Mail) => Promise<unknown>

/** Mail over `LACUNO_SMTP_URL` from `LACUNO_MAIL_FROM`; none without them. */
export function smtp(): Send | undefined {
  const url = process.env.LACUNO_SMTP_URL
  const from = process.env.LACUNO_MAIL_FROM
  if (!url && !from) return
  if (!url || !from) throw new Error('Set LACUNO_SMTP_URL and LACUNO_MAIL_FROM together')
  // Nodemailer loads with the first message, so a server that sends none starts without it.
  let transport: Transporter | undefined
  return async (mail) => {
    transport ??= (await import('nodemailer')).createTransport(url, { from })
    return transport.sendMail(mail)
  }
}
