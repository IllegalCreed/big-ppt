import type {
  BlackoutMode,
  DrawingStroke,
  DrawingTool,
  PresentationSnapshot,
} from '@big-ppt/shared'

export type {
  BlackoutMode,
  DrawingPoint,
  DrawingStroke,
  DrawingTool,
  PresentationSnapshot,
  SlideDrawings,
} from '@big-ppt/shared'

export type DrawingMode = DrawingTool | 'eraser'
export type PresentationUiTheme = 'dark' | 'light'

export type PresentationChannelMessage =
  | { type: 'state-request'; sender: string }
  | { type: 'state'; sender: string; state: PresentationSnapshot }
  | { type: 'page'; sender: string; page: number }
  | { type: 'blackout'; sender: string; blackout: BlackoutMode }
  | { type: 'drawings'; sender: string; page: number; strokes: DrawingStroke[] }

export { DRAWING_VIEWBOX_HEIGHT, DRAWING_VIEWBOX_WIDTH } from '@big-ppt/shared'
