import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export interface DevicePushResult {
  fcmToken: string;
  success: boolean;
  messageId?: string;
  error?: string;
}

@Injectable()
export class FcmService implements OnModuleInit {
  private readonly logger = new Logger(FcmService.name);
  private firebaseApp: any = null;

  constructor(
    @InjectDataSource('school') private readonly ds: DataSource,
  ) {}

  onModuleInit() {
    try {
      let admin: any;
      try {
        admin = require('firebase-admin');
      } catch {
        this.logger.warn(
          'firebase-admin package is not installed — school push notifications disabled.',
        );
        return;
      }

      const projectId = process.env.FCM_PROJECT_ID;
      const clientEmail = process.env.FCM_CLIENT_EMAIL;
      const privateKey = process.env.FCM_PRIVATE_KEY?.replace(/\\n/g, '\n');

      if (!projectId || !clientEmail || !privateKey) {
        this.logger.warn(
          'FCM credentials (FCM_PROJECT_ID / FCM_CLIENT_EMAIL / FCM_PRIVATE_KEY) not fully configured — school push notifications disabled.',
        );
        return;
      }

      // Use a named app so we don't clash with coaching's default app
      const appName = 'school-fcm';
      const apps = typeof admin.getApps === 'function' ? admin.getApps() : (admin.apps || []);
      const existingApp = apps.find((a: any) => a?.name === appName);
      if (existingApp) {
        this.firebaseApp = existingApp;
        this.logger.log('Reusing existing Firebase Admin app "school-fcm".');
        return;
      }

      this.firebaseApp = admin.initializeApp(
        {
          credential: admin.cert({ projectId, clientEmail, privateKey }),
        },
        appName,
      );
      this.logger.log('Firebase Admin app "school-fcm" initialised successfully.');
    } catch (err: any) {
      this.logger.error(
        `Failed to initialize FCM Push Service gracefully: ${err.message}`,
      );
    }
  }

  /** Whether the Firebase app was successfully initialised. */
  get isReady(): boolean {
    return !!this.firebaseApp;
  }

  /**
   * Checks whether the user has push notifications and a specific alert type enabled.
   * If no preferences exist, defaults to true.
   */
  async checkUserPreference(userId: string, alertField: string): Promise<boolean> {
    try {
      const rows = await this.ds.query(
        `SELECT enable_push, "${alertField}" FROM notification_preferences WHERE user_id = $1`,
        [userId],
      );
      if (!rows.length) return true;
      const p = rows[0];
      if (p.enable_push === false) return false;
      return p[alertField] !== false;
    } catch (err: any) {
      this.logger.error(`Failed to check notification preferences for user ${userId}: ${err.message}`);
      return true; // Default to true if check fails
    }
  }

  // ── Core send helper ──────────────────────────────────────────────────────

  /**
   * Send a push notification to **all** registered devices for a given user.
   *
   * - Fetches every row from `school_device_tokens` for `userId`.
   * - Sends to each token individually via `messaging().send()`.
   * - If FCM returns an unregistered / invalid-token error the stale row is
   *   deleted automatically.
   * - Returns an array of per-token results so the caller can decide the
   *   aggregate outcome.
   */
  async sendPushToUser(
    userId: string,
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<DevicePushResult[]> {
    if (!this.firebaseApp) {
      this.logger.warn('sendPushToUser called but Firebase Admin is not initialised.');
      return [];
    }

    const tokens: any[] = await this.ds.query(
      `SELECT id, fcm_token FROM school_device_tokens WHERE user_id = $1`,
      [userId],
    );

    if (!tokens.length) {
      return [];
    }

    const { getMessaging } = require('firebase-admin/messaging');
    const messaging = getMessaging(this.firebaseApp);
    const results: DevicePushResult[] = [];

    for (const row of tokens) {
      const payload: any = {
        token: row.fcm_token,
        notification: { title, body },
      };
      if (data) {
        payload.data = data;
      }

      try {
        const messageId: string = await messaging.send(payload);
        results.push({ fcmToken: row.fcm_token, success: true, messageId });
      } catch (err: any) {
        const code: string = err?.code || err?.errorInfo?.code || '';
        const isStale =
          code.includes('registration-token-not-registered') ||
          code.includes('invalid-registration-token') ||
          code.includes('messaging/invalid-argument');

        if (isStale) {
          this.logger.warn(
            `Removing stale FCM token (id=${row.id}) for user ${userId}: ${code}`,
          );
          await this.ds
            .query(`DELETE FROM school_device_tokens WHERE id = $1`, [row.id])
            .catch((delErr: any) =>
              this.logger.error(`Failed to delete stale token: ${delErr.message}`),
            );
        }

        results.push({ fcmToken: row.fcm_token, success: false, error: err.message });
      }
    }

    return results;
  }

  /**
   * Sends a multicast push notification to a large group of tokens, chunked in batches of 500.
   * Auto-cleans stale/invalid tokens from the database.
   */
  async sendMulticastPush(
    tokens: string[],
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<{ success: boolean; sentCount: number; failedCount: number }> {
    if (!this.firebaseApp) {
      this.logger.warn('sendMulticastPush called but Firebase Admin is not initialised.');
      return { success: false, sentCount: 0, failedCount: 0 };
    }

    if (!tokens || tokens.length === 0) {
      return { success: true, sentCount: 0, failedCount: 0 };
    }

    const { getMessaging } = require('firebase-admin/messaging');
    const messaging = getMessaging(this.firebaseApp);

    let sentCount = 0;
    let failedCount = 0;

    // Chunk into groups of 500
    for (let i = 0; i < tokens.length; i += 500) {
      const chunk = tokens.slice(i, i + 500);
      const payload: any = {
        tokens: chunk,
        notification: { title, body },
      };
      if (data) {
        payload.data = data;
      }

      try {
        const response = await messaging.sendEachForMulticast(payload);
        sentCount += response.successCount;
        failedCount += response.failureCount;

        // Clean up invalid/stale tokens in the background
        if (response.failureCount > 0) {
          const tokensToDelete: string[] = [];
          response.responses.forEach((res: any, idx: number) => {
            if (!res.success) {
              const err = res.error;
              const code = err?.code || err?.errorInfo?.code || '';
              const isStale =
                code.includes('registration-token-not-registered') ||
                code.includes('invalid-registration-token') ||
                code.includes('messaging/invalid-argument');
              if (isStale) {
                tokensToDelete.push(chunk[idx]);
              }
            }
          });

          if (tokensToDelete.length > 0) {
            this.ds.query(
              `DELETE FROM school_device_tokens WHERE fcm_token = ANY($1::varchar[])`,
              [tokensToDelete]
            ).catch((err: any) => this.logger.error(`Failed to delete stale multicast tokens: ${err.message}`));
          }
        }
      } catch (err: any) {
        this.logger.error(`Multicast batch failed: ${err.message}`);
        failedCount += chunk.length;
      }
    }

    return { success: true, sentCount, failedCount };
  }
}
