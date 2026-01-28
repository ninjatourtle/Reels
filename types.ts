
export interface ComicPage {
  id: string;
  url: string;
  name: string;
  base64: string;
}

export type MotionType = 'ZOOM_IN' | 'ZOOM_OUT' | 'PAN_LEFT' | 'PAN_RIGHT' | 'STILL' | 'SMART_FOCUS';
export type ActionFxType = 'NONE' | 'POW' | 'BOOM' | 'CRASH' | 'ZAP' | 'BANG';

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface StoryScene {
  id: string;
  imageReferenceId: string;
  voiceoverText: string;
  motionType: MotionType;
  duration: number;
  voiceName?: string; // Individual voice for character
  panelBox?: BoundingBox; // Focus area identified by AI
  actionFx?: ActionFxType;
}

export interface ComicStory {
  id: string;
  title: string;
  summary: string;
  storyboard: StoryScene[];
  voiceName: string;
  musicMood: string;
  showSubtitles: boolean;
}

export interface VideoProject {
  id: string;
  comicTitle: string;
  stories: ComicStory[];
  pages: ComicPage[];
}
