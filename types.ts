export type ImageSize = '1K' | '2K' | '4K';
export type AspectRatio = '1:1' | '3:4' | '4:3' | '9:16' | '16:9';

export type FilmStock = 
  | 'Kodak Portra 400' 
  | 'Kodak Gold 200' 
  | 'Kodak Ektachrome E100'
  | 'Kodak Tri-X 400 (B&W)'
  | 'Fujifilm Velvia 50'
  | 'Fujifilm Provia 100F'
  | 'Fujifilm Pro 400H'
  | 'Ilford HP5 Plus (B&W)'
  | 'Cinestill 800T';

export type ISOValue = 200 | 400 | 800 | 1600;

export interface ProcessedImage {
  id: string;
  originalUrl: string;
  processedUrl: string;
  timestamp: number;
  prompt: string;
  size: ImageSize;
  aspectRatio: AspectRatio;
  filmStock: FilmStock;
  iso: ISOValue;
  skinDetail: number; // Intensity of skin imperfection reconstruction (0-100)
  selected?: boolean; // For comparison feature
}

export interface ProcessingState {
  status: 'idle' | 'checking-key' | 'uploading' | 'processing' | 'error';
  message?: string;
}

declare global {
  interface AIStudio {
    hasSelectedApiKey: () => Promise<boolean>;
    openSelectKey: () => Promise<void>;
  }

  interface Window {
    // Added readonly modifier to ensure identical modifiers with the global declaration in the environment.
    readonly aistudio: AIStudio;
  }
}