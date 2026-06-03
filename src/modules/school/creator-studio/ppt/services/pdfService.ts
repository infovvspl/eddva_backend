// @ts-nocheck
import { PDFParse } from "pdf-parse";

import {
  cleanPDFText,
  chunkText,
  detectSubjectFromText,
  detectClassFromText,
} from "../utils/pdf.utils";

/*
==========================================
PDF SERVICE
Extracts and preprocesses educational PDF content
Uses pdf-parse v2+ via standard ES module import
==========================================
*/

import { BadRequestException } from '@nestjs/common';

/**
 * Extracts, cleans, and analyzes a PDF from a Buffer.
 * Does NOT use binary tools — text-only extraction via pdf-parse.
 *
 * @param {Buffer} fileBuffer - raw PDF file buffer (from multer memoryStorage)
 * @param {object} options - optional hints: { classLevel, subject }
 * @returns {Promise<object>} {
 *   cleanedText: string,
 *   chunks: string[],
 *   pageCount: number,
 *   detectedSubject: string,
 *   detectedClass: string,
 * }
 */
export const extractFromPDF = async (fileBuffer, options = {}) => {

  console.log("=== extractFromPDF CALLED ===");
  if (!fileBuffer || !Buffer.isBuffer(fileBuffer) || fileBuffer.length === 0) {
    console.log("=== extractFromPDF FAILED: Invalid Buffer ===");
    throw new BadRequestException("Invalid or empty PDF file uploaded.");
  }

  /*
  ==========================================
  STEP 1: EXTRACT TEXT WITH pdf-parse
  ==========================================
  */

  console.log("Starting PDF extraction...");
  console.log(`PDF size: ${fileBuffer.length} bytes`);

  let rawText = "";
  let pageCount = 1;

  try {
    const parser = new PDFParse({ data: fileBuffer });
    const pdfData = await parser.getText();
    
    rawText = pdfData.text || "";
    pageCount = pdfData.total || 1;
    
    await parser.destroy();
    
    console.log("Extraction success");
  } catch (parseError) {
    throw new BadRequestException(`Failed to parse PDF file. The file might be corrupted or not a valid PDF document. (Error: ${parseError.message})`);
  }

  if (!rawText || !rawText.trim()) {
    throw new BadRequestException(
      "No readable text found in the PDF. The file may be image-based, scanned, or password-protected."
    );
  }

  /*
  ==========================================
  STEP 2: CLEAN TEXT & HIERARCHY EXTRACTION
  ==========================================
  */

  const cleanedText = cleanPDFText(rawText);

  // Extract chapter title heuristic (first non-empty line or explicit "Chapter X")
  const chapterMatch = cleanedText.match(/^(?:Chapter\s+\d+:?\s*)?([A-Z][^\n]{2,100})/i);
  const chapterTitle = chapterMatch ? chapterMatch[1].trim() : "Unknown Chapter";

  // Headings (e.g., "1. Introduction" or "1 Introduction")
  const mainHeadings = cleanedText.match(/^\d+[\.\s]+[A-Za-z][^\n]{0,100}$/gm) || [];
  
  // Subheadings (e.g., "1.1 Background" or "1.1.1 Detail")
  const subHeadings = cleanedText.match(/^\d+\.\d+(?:\.\d+)*\s+[A-Za-z][^\n]{0,100}$/gm) || [];

  const uniqueHeadings = [...new Set(mainHeadings)];
  const uniqueSubheadings = [...new Set(subHeadings)];

  if (cleanedText.length < 100) {
    throw new Error(
      "PDF contains too little text content to generate a presentation."
    );
  }

  /*
  ==========================================
  STEP 3: CHUNK FOR AI PROCESSING
  ==========================================
  */

  const chunks = chunkText(cleanedText, 10000);

  console.log(`📖 Text length: ${cleanedText.length}`);
  console.log(`📦 Chunks created: ${chunks.length}`);

  /*
  ==========================================
  STEP 4: AUTO-DETECT SUBJECT & CLASS
  ==========================================
  */

  const detectedSubject = options.subject && options.subject !== "General"
    ? options.subject
    : detectSubjectFromText(cleanedText);

  const detectedClass = options.classLevel
    ? options.classLevel
    : detectClassFromText(cleanedText);

  console.log(`📚 Chapter Title: ${chapterTitle}`);
  console.log(`📚 Headings detected: ${uniqueHeadings.length}`);
  if (uniqueHeadings.length > 0) {
    console.log(uniqueHeadings.slice(0, 5));
  }
  
  console.log(`📚 Subheadings detected: ${uniqueSubheadings.length}`);
  if (uniqueSubheadings.length > 0) {
    console.log(uniqueSubheadings.slice(0, 5));
  }

  console.log(`📄 PDF extraction complete:`);
  console.log(`   Number of extracted characters: ${cleanedText.length}`);
  console.log(`   Number of chunks created: ${chunks.length}`);
  console.log(`   Page count: ${pageCount}`);
  console.log(`   🔍 Detected subject: ${detectedSubject}, Class: ${detectedClass}`);

  return {
    cleanedText,
    chunks,
    headings: uniqueHeadings,
    subheadings: uniqueSubheadings,
    chapterTitle,
    pageCount,
    detectedSubject,
    detectedClass,
  };
};
