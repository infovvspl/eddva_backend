/** ESM entry — use this import path (see content.service.ts). */
declare module 'youtube-transcript/dist/youtube-transcript.esm.js' {
  export interface TranscriptSegment {
    text: string;
    duration: number;
    offset: number;
    lang?: string;
  }

  export interface FetchTranscriptOptions {
    lang?: string;
    country?: string;
  }

  export class YoutubeTranscript {
    static fetchTranscript(
      videoId: string,
      options?: FetchTranscriptOptions,
    ): Promise<TranscriptSegment[]>;
  }

  export class YoutubeTranscriptError extends Error {}
  export class YoutubeTranscriptTooManyRequestError extends YoutubeTranscriptError {}
  export class YoutubeTranscriptVideoUnavailableError extends YoutubeTranscriptError {}
  export class YoutubeTranscriptDisabledError extends YoutubeTranscriptError {}
  export class YoutubeTranscriptNotAvailableError extends YoutubeTranscriptError {}
  export class YoutubeTranscriptNotAvailableLanguageError extends YoutubeTranscriptError {}
}
