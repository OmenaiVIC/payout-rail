import nodemailer from 'nodemailer';

/**
 * BOS Monitoring — Notifier Abstraction
 *
 * Notifier interface:
 *   async send({ alertType, severity, message, details }) → void
 *
 * Implementations: SlackNotifier, EmailNotifier, CompositeNotifier
 */

class SlackNotifier {
  constructor(webhookUrl) {
    this.webhookUrl = webhookUrl;
  }

  async send({ alertType, severity, message, details }) {
    if (!this.webhookUrl) return;

    const emoji = severity === 'critical' ? '🚨' : '⚠️';
    const payload = {
      text: `${emoji} *BOS Alert: ${alertType}*`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `${emoji} *${severity.toUpperCase()}* — *${alertType}*\n${message}`,
          },
        },
      ],
    };

    if (details && Object.keys(details).length > 0) {
      payload.blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '```' + JSON.stringify(details, null, 2) + '```',
        },
      });
    }

    try {
      const resp = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        console.error(`[notifier:slack] Failed: ${resp.status} ${resp.statusText}`);
      }
    } catch (err) {
      console.error(`[notifier:slack] Error: ${err.message}`);
    }
  }
}

class EmailNotifier {
  constructor(recipients, transporter) {
    this.recipients = recipients;
    this.transporter = transporter;
  }

  async send({ alertType, severity, message, details }) {
    if (!this.transporter || !this.recipients?.length) return;

    const subject = `[Payout Rail BOS] ${severity.toUpperCase()}: ${alertType}`;
    const body = [
      `Alert: ${alertType}`,
      `Severity: ${severity}`,
      `Time: ${new Date().toISOString()}`,
      '',
      message,
      '',
      details ? `Details:\n${JSON.stringify(details, null, 2)}` : '',
    ].join('\n');

    try {
      await this.transporter.sendMail({
        from: `"Payout Rail BOS Monitor" <${process.env.SMTP_USER}>`,
        to: this.recipients.join(', '),
        subject,
        text: body,
      });
    } catch (err) {
      console.error(`[notifier:email] Error: ${err.message}`);
    }
  }
}

class CompositeNotifier {
  constructor(notifiers = []) {
    this.notifiers = notifiers;
  }

  async send(alert) {
    const results = await Promise.allSettled(
      this.notifiers.map((n) => n.send(alert))
    );
    const failures = results.filter((r) => r.status === 'rejected');
    if (failures.length > 0) {
      console.error(`[notifier:composite] ${failures.length}/${this.notifiers.length} notifiers failed`);
    }
  }
}

/**
 * Build a notifier from environment variables.
 */
export function buildNotifier() {
  const notifiers = [];

  const slackUrl = process.env.SLACK_BOS_WEBHOOK_URL;
  if (slackUrl) {
    notifiers.push(new SlackNotifier(slackUrl));
  }

  const emailRecipients = process.env.BOS_ALERT_EMAIL_RECIPIENTS
    ? process.env.BOS_ALERT_EMAIL_RECIPIENTS.split(',').map((s) => s.trim()).filter(Boolean)
    : [];

  if (emailRecipients.length > 0 && process.env.SMTP_USER && process.env.SMTP_PASS) {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    notifiers.push(new EmailNotifier(emailRecipients, transporter));
  }

  if (notifiers.length === 0) {
    console.warn('[notifier] No notification channels configured (SLACK_BOS_WEBHOOK_URL / BOS_ALERT_EMAIL_RECIPIENTS)');
    // Return a console-based fallback
    return {
      async send(alert) {
        console.log(`[bos:alert:${alert.severity}] ${alert.alertType}: ${alert.message}`);
      },
    };
  }

  return new CompositeNotifier(notifiers);
}

export { SlackNotifier, EmailNotifier, CompositeNotifier };
export default { SlackNotifier, EmailNotifier, CompositeNotifier, buildNotifier };
