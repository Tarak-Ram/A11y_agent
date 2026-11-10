import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { createTransport, Transporter } from 'nodemailer';

/** SMTP mail (SMTP_URL, e.g. smtps://user:pass@smtp.example.com). Without SMTP_URL, mails are logged, not sent. */
@Injectable()
export class MailService {
  private log = new Logger(MailService.name);
  private transport: Transporter | null = process.env.SMTP_URL ? createTransport(process.env.SMTP_URL) : null;

  get enabled() {
    return this.transport !== null;
  }

  async send(to: string, subject: string, text: string) {
    if (!this.transport) {
      this.log.warn(`SMTP_URL not set; would have emailed ${to}: ${subject}`);
      return false;
    }
    await this.transport.sendMail({ from: process.env.MAIL_FROM ?? 'A11yAgents <no-reply@localhost>', to, subject, text });
    return true;
  }
}

@Global()
@Module({ providers: [MailService], exports: [MailService] })
export class MailModule {}
