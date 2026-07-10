export type BlackoutMode = 'none' | 'black' | 'white'
export type DrawingTool = 'pen' | 'highlighter'
export type PresentationUiTheme = 'dark' | 'light'

export interface DrawingPoint {
  x: number
  y: number
}

export interface DrawingStroke {
  id: string
  tool: DrawingTool
  color: string
  width: number
  points: DrawingPoint[]
}

export type SlideDrawings = Record<number, DrawingStroke[]>

export interface PresentationSnapshot {
  page: number
  blackout: BlackoutMode
  drawings: SlideDrawings
}

export type PresentationChannelMessage =
  | { type: 'state-request'; sender: string }
  | { type: 'state'; sender: string; state: PresentationSnapshot }
  | { type: 'page'; sender: string; page: number }
  | { type: 'blackout'; sender: string; blackout: BlackoutMode }
  | { type: 'drawings'; sender: string; page: number; strokes: DrawingStroke[] }

export const DRAWING_VIEWBOX_WIDTH = 1000
export const DRAWING_VIEWBOX_HEIGHT = 562.5
