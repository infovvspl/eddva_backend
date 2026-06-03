// @ts-nocheck
import fs from "fs";
import path from "path";

export const searchImage = async (query) => {
  try {
    const placeholderPath = path.join(process.cwd(), "assets", "placeholder.jpg");
    if (fs.existsSync(placeholderPath)) {
      return placeholderPath;
    }
    return null;
  } catch (error) {
    console.log("Image search failed:", error.message);
    return null;
  }
};
