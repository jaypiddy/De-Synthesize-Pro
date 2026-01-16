import { GoogleGenAI } from "@google/genai";
import { ImageSize, AspectRatio } from "../types";

export const processImage = async (
  base64Image: string,
  mimeType: string,
  prompt: string,
  size: ImageSize = '1K',
  aspectRatio: AspectRatio = '1:1'
): Promise<string> => {
  // Always create a fresh instance to ensure the most up-to-date key is used
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-image-preview',
      contents: {
        parts: [
          {
            inlineData: {
              data: base64Image,
              mimeType: mimeType,
            },
          },
          {
            text: prompt,
          },
        ],
      },
      config: {
        imageConfig: {
          aspectRatio: aspectRatio,
          imageSize: size,
        },
      },
    });

    // Check if the overall response was blocked at the prompt level
    if (!response.candidates || response.candidates.length === 0) {
      throw new Error("REJECTION: The Lab could not process this image. WHY: The source image triggered automated safety filters, which often happens with content that is interpreted as sensitive or restricted. REMEDY: Please try a different photo. Ensure the subject is clearly a standard portrait and the composition is neutral.");
    }

    const candidate = response.candidates[0];

    // Handle specific finish reasons with helpful plain-English explanations
    if (candidate.finishReason === 'SAFETY') {
      throw new Error("REJECTION: Development halted due to safety guardrails. WHY: The Emulsion Engine detected features in the image that are restricted for processing. This is a common precaution for certain types of portraits. REMEDY: Try an image with more standard lighting, a clear head-and-shoulders crop, or a different character subject.");
    }

    if (candidate.finishReason === 'RECITATION') {
      throw new Error("REJECTION: Style processing failed. WHY: The requested development style or the subject matter closely matches protected content or copyright-sensitive material. REMEDY: Try a different film stock or a less specific subject to proceed with development.");
    }

    if (candidate.finishReason === 'OTHER') {
      throw new Error("REJECTION: An unexpected lab interruption occurred. WHY: The model encountered an internal error or the content was rejected for an unspecified safety reason. REMEDY: Attempt the development again with a slightly different grain intensity or a new source image.");
    }

    // Iterate through parts to find the image
    const parts = candidate.content?.parts || [];
    let refusalText = "";
    
    for (const part of parts) {
      if (part.inlineData) {
        return `data:image/png;base64,${part.inlineData.data}`;
      }
      if (part.text) {
        refusalText += part.text + " ";
      }
    }

    // If we got here, no image was found. Check if there was descriptive text explaining why.
    if (refusalText.trim()) {
      throw new Error(`REJECTION: The Lab encountered a problem. WHY: ${refusalText.trim()} REMEDY: Adjust your input image or settings to resolve the concern mentioned above.`);
    }

    // Final fallback for missing content
    throw new Error("REJECTION: The Lab was unable to generate the new texture. WHY: Although the image was accepted, the reconstruction process failed to complete safely. REMEDY: Please try a different image. Ensure the person is in a well-lit environment and the framing is a typical photographic portrait.");

  } catch (error: any) {
    console.error("Gemini API Error Detail:", error);
    
    // Pass through our custom REJECTION errors
    if (error.message && error.message.startsWith("REJECTION:")) {
      throw error;
    }

    // Handle specific API/Network error codes
    const errorMessage = error.message || "";
    
    if (errorMessage.includes("403") || error.status === 403) {
      throw new Error("PERMISSION_DENIED: gemini-3-pro-image-preview requires a PAID API key from a Google Cloud project with billing enabled. Please check your project status at ai.google.dev/gemini-api/docs/billing");
    }

    if (errorMessage.includes("Requested entity was not found.")) {
      throw new Error("KEY_RESET_REQUIRED");
    }

    if (errorMessage.includes("429")) {
      throw new Error("The lab is busy. WHY: Rate limit exceeded. REMEDY: Please wait 60 seconds before submitting the next negative for development.");
    }

    throw new Error(errorMessage || "A technical chemical imbalance occurred in the lab. Please check your connection and try again.");
  }
};