
import { GoogleGenAI, Type, Modality } from "@google/genai";
import { ComicPage, ComicStory, MotionType, BoundingBox } from "../types";

export class GeminiService {
  constructor() {}

  private getActiveAI() {
    return new GoogleGenAI({ apiKey: process.env.API_KEY as string });
  }

  async analyzeComic(pages: ComicPage[]): Promise<ComicStory[]> {
    const ai = this.getActiveAI();
    
    const imageParts = pages.slice(0, 10).flatMap((page, idx) => [
      { text: `PAGE_${idx}:` },
      {
        inlineData: {
          data: page.base64.split(',')[1],
          mimeType: page.base64.match(/^data:(image\/[a-z]+);base64,/)?.[1] || 'image/jpeg'
        }
      }
    ]);

    const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview",
      contents: [
        ...imageParts,
        {
          text: `Ты — профессиональный режиссер монтажа и эксперт по комиксам. 
          Проанализируй эти страницы и создай 2 захватывающих сценария для Reels на РУССКОМ языке.
          
          ВАЖНО: Для каждой сцены определи координаты ГЛАВНОГО действия (панели) на странице.
          Координаты panelBox должны быть в процентах (0-100).
          
          Используй разные голоса (Kore, Puck, Charon, Fenrir, Zephyr) для разных персонажей.
          Добавляй ActionFx (POW, BOOM, CRASH) где это уместно для динамики.`
        }
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              summary: { type: Type.STRING },
              storyboard: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    imageReferenceId: { type: Type.STRING, description: "Index of the image in the input list" },
                    voiceoverText: { type: Type.STRING },
                    motionType: { type: Type.STRING, enum: ['ZOOM_IN', 'ZOOM_OUT', 'PAN_LEFT', 'PAN_RIGHT', 'STILL', 'SMART_FOCUS'] },
                    duration: { type: Type.NUMBER },
                    voiceName: { type: Type.STRING },
                    actionFx: { type: Type.STRING, enum: ['NONE', 'POW', 'BOOM', 'CRASH', 'ZAP', 'BANG'] },
                    panelBox: {
                      type: Type.OBJECT,
                      properties: {
                        x: { type: Type.NUMBER },
                        y: { type: Type.NUMBER },
                        width: { type: Type.NUMBER },
                        height: { type: Type.NUMBER }
                      },
                      required: ["x", "y", "width", "height"]
                    }
                  },
                  required: ["imageReferenceId", "voiceoverText", "motionType", "duration", "panelBox"]
                }
              }
            },
            required: ["title", "summary", "storyboard"]
          }
        }
      }
    });

    const data = JSON.parse(response.text || "[]");
    return data.map((story: any, index: number) => ({
      ...story,
      id: `story-${Date.now()}-${index}`,
      voiceName: 'Kore',
      musicMood: 'None',
      showSubtitles: true,
      storyboard: story.storyboard.map((scene: any, sIdx: number) => {
        const pageIdx = parseInt(scene.imageReferenceId.toString().replace(/\D/g, '')) || 0;
        const validIdx = Math.min(Math.max(0, pageIdx), pages.length - 1);
        return {
          ...scene,
          id: `scene-${Date.now()}-${sIdx}`,
          imageReferenceId: pages[validIdx].id,
          voiceName: scene.voiceName || 'Kore'
        };
      })
    }));
  }

  async generateVoiceover(text: string, voiceName: string = 'Kore'): Promise<AudioBuffer> {
    const ai = this.getActiveAI();
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: voiceName },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) throw new Error("Audio generation failed");

    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    const binary = atob(base64Audio);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    
    const dataInt16 = new Int16Array(bytes.buffer);
    const buffer = ctx.createBuffer(1, dataInt16.length, 24000);
    const channelData = buffer.getChannelData(0);
    for (let i = 0; i < dataInt16.length; i++) channelData[i] = dataInt16[i] / 32768.0;
    
    return buffer;
  }
}

export const geminiService = new GeminiService();
