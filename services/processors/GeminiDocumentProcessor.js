import { GoogleGenerativeAI } from '@google/generative-ai';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { v4 as uuidv4 } from 'uuid';
import { existsSync } from 'fs';
import * as fs from 'fs';
import BaseDocumentProcessor from './BaseDocumentProcessor.js';
import { storage } from '../../config/firebase-admin.js';
import FileAdapter from './FileAdapter.js';

/**
 * Document processor implementation using Google's Gemini AI
 */
class GeminiDocumentProcessor extends BaseDocumentProcessor {
  /**
   * Create a new GeminiDocumentProcessor
   * @param {string} apiKey - Gemini API key (optional, will use env var if not provided)
   */
  constructor(apiKey) {
    super();
    this.genAI = new GoogleGenerativeAI(apiKey || process.env.GEMINI_API_KEY || 'AIzaSyCL8ylcFY93vBYzVukHAP9psxuG_2v26w8');
    this.model = this.genAI.getGenerativeModel({ model: "gemini-1.5-pro" });
  }

  /**
   * Get the Firebase Storage bucket
   * @returns {Object} - Firebase Storage bucket
   */
  _getBucket() {
    return storage.bucket();
  }

  /**
   * Process document
   * @param {Document|Object} document - Document model or file-like object
   * @returns {Promise<Object>} - Processing results
   */
  async processDocument(document) {
    console.log(`Processing document ${document.fileName || 'unnamed'} with Gemini`);
    
    try {
      // For direct file processing (like in the anubhav branch)
      if (document.buffer) {
        console.log('Processing direct file upload with Gemini');
        
        // Create base64 representation
        const fileType = document.fileType || document.mimetype;
        const base64Data = document.buffer.toString('base64');
        
        // Process according to file type
        if (['image/jpeg', 'image/jpg', 'image/png'].includes(fileType)) {
          const base64Image = `data:${fileType};base64,${base64Data}`;
          const result = await this.processImageWithGemini(base64Image);
          return {
            success: true,
            document: result.document,
            medications: result.medications || [],
            documentType: result.documentType
          };
        } 
        else if (fileType === 'application/pdf') {
          const base64Pdf = `data:${fileType};base64,${base64Data}`;
          const result = await this.processPdfWithGemini(base64Pdf);
          return {
            success: true,
            document: result.document,
            medications: result.medications || [],
            documentType: result.documentType
          };
        }
      }
      
      // Otherwise, use the standard class-based approach
      return super.processDocument(document);
    } catch (error) {
      console.error('Error processing document with Gemini:', error);
      return {
        success: false,
        error: error.message || 'Failed to process document with Gemini'
      };
    }
  }

  /**
   * Convert document to base64 for Gemini API
   * @param {Document} document - Document model
   * @returns {Promise<{base64Data: string, mimeType: string}>} - Base64 data for the document
   */
  async _documentToBase64(document) {
    // If document has a buffer (like a direct file upload), use it
    if (document.buffer) {
      return {
        base64Data: document.buffer.toString('base64'),
        mimeType: document.fileType || document.mimetype
      };
    }
    
    // Use the FileAdapter for consistency
    return FileAdapter.toBase64(document);
  }

  /**
   * Extract text from a document
   * @param {Document} document - Document model instance
   * @returns {Promise<string>} - Extracted text
   */
  async extractText(document) {
    console.log(`Extracting text from ${document.fileName || 'unnamed'} using Gemini`);
    
    try {
      const { base64Data, mimeType } = await this._documentToBase64(document);
      
      // Create content parts for the document
      const docPart = {
        inlineData: {
          data: base64Data,
          mimeType
        }
      };
      
      // Extract text with Gemini
      const extractPrompt = "Extract and transcribe all text content from this document. Include all information in a plain text format.";
      const extractResult = await this.model.generateContent([extractPrompt, docPart]);
      
      return extractResult.response.text();
    } catch (error) {
      console.error('Error extracting text with Gemini:', error);
      return `Error extracting text: ${error.message}`;
    }
  }
  
  /**
   * Analyze a document and classify it
   * @param {Document} document - Document model instance
   * @param {string} text - Extracted text content
   * @returns {Promise<Object>} - Analysis results
   */
  async analyzeDocument(document, text) {
    console.log(`Analyzing document ${document.fileName || 'unnamed'} using Gemini`);
    
    try {
      const { base64Data, mimeType } = await this._documentToBase64(document);
      
      // Create content parts for the document
      const docPart = {
        inlineData: {
          data: base64Data,
          mimeType
        }
      };
      
      // Classify document
      const classifyPrompt = "Analyze this medical document and classify it into exactly ONE of these categories: PRESCRIPTION, LAB_REPORT, INSURANCE, CLINICAL_NOTES, MISCELLANEOUS. Return ONLY the category name without any additional text or explanation.";
      const classifyResult = await this.model.generateContent([classifyPrompt, docPart]);
      const documentType = classifyResult.response.text().trim().toUpperCase();
      
      console.log('Document classified as:', documentType);
      
      // Valid document types
      const validTypes = ['PRESCRIPTION', 'LAB_REPORT', 'INSURANCE', 'CLINICAL_NOTES', 'MISCELLANEOUS'];
      const docType = validTypes.includes(documentType) ? documentType : 'MISCELLANEOUS';
      
      // Extract medications if it's a prescription
      let medications = [];
      if (docType === 'PRESCRIPTION') {
        medications = await this._extractMedications(docPart);
      }
      
      return {
        documentType: docType,
        medications
      };
    } catch (error) {
      console.error('Error analyzing document with Gemini:', error);
      return {
        documentType: 'MISCELLANEOUS',
        medications: []
      };
    }
  }
  
  /**
   * Process PDF file with Gemini AI
   * @param {string} base64Pdf - Base64-encoded PDF
   * @returns {Promise<Object>} - Processing results
   */
  async processPdfWithGemini(base64Pdf) {
    try {
      // Create a content part for the PDF
      const pdfPart = {
        inlineData: {
          data: base64Pdf.split(',')[1],
          mimeType: 'application/pdf'
        }
      };
      
      // Prompts for PDF processing
      const classifyPrompt = "Analyze this medical document PDF and classify it into exactly ONE of these categories: PRESCRIPTION, LAB_REPORT, INSURANCE, CLINICAL_NOTES, MISCELLANEOUS. Return ONLY the category name without any additional text or explanation.";
      
      const contentPrompt = "Simplify this medical document for a patient with no medical background. Transform complex medical information into clear, actionable insights anyone can understand. Format your response with these sections: # What This Means For You, # Key Actions, # Important Information, # Health Terms Simplified. Write at a 6th-grade reading level with short sentences and simple words. Focus on practical information, not technical details.";
      
      // Prompt for medication extraction
      const medPrompt = `
        Extract a comprehensive list of ALL medications visible in this medical document.
        For each medication, provide the following information as a JSON object:
        
        1.  Name: An object containing:
            *   Generic: The generic name (e.g., "Metformin"). Provide null if not found.
            *   Brand: The brand name (e.g., "Glucophage"). Provide null if not found.
        2.  SuggestedName: IF AND ONLY IF both Generic and Brand names are null, provide a short, descriptive fallback name based on the medication's apparent use or type (e.g., "Pain Reliever", "Blood Pressure Pill", "Iron Supplement"). Otherwise, this field should be null or omitted.
        3.  Dosage: Dosage strength and form (e.g., "500mg tablet", "1 spray"). Provide null if not found.
        4.  Frequency: How often to take it (e.g., "Once daily", "Twice a day"). Provide null if not found.
        5.  Purpose: Briefly explain what symptom or condition it treats in patient-friendly terms. Provide null if not found.
        6.  Special Instructions: Extract any specific instructions like "Take with food", "Avoid alcohol", in simple language. 
            *   If instructions are found in the document: Provide them as a string.
            *   If a medication Name (Generic/Brand/Suggested) IS identified BUT specific instructions ARE NOT found in the document: Check your general knowledge for this medication. If common/important standard instructions exist (e.g., "Take levothyroxine on an empty stomach"), provide them as a string AND add a field "isGeneralKnowledgeInstructions: true". 
            *   Otherwise, provide null.
        7.  Important Side Effects: List serious or common side effects/warnings mentioned in the document.
            *   If side effects/warnings are found in the document: Provide them as a string.
            *   If a medication Name (Generic/Brand/Suggested) IS identified BUT specific side effects/warnings ARE NOT found in the document: Check your general knowledge for this medication. If well-known common or important side effects exist (e.g., "Metformin may cause digestive upset"), list 1-3 key ones as a string AND add a field "isGeneralKnowledgeSideEffects: true".
            *   Otherwise, provide null.

        Format the final output strictly as a JSON array containing these medication objects. Ensure all fields (e.g., "isGeneralKnowledgeInstructions") are included, set to "true" or "false"/"null" as appropriate.
        Make sure the output is ONLY the JSON array and nothing else before or after it.
      `;
      
      // Get document type
      const classifyResult = await this.model.generateContent([
        classifyPrompt,
        pdfPart
      ]);
      const documentType = classifyResult.response.text().trim().toUpperCase();
      console.log('Document classified as:', documentType);
      
      // Validate document type
      const validTypes = ['PRESCRIPTION', 'LAB_REPORT', 'INSURANCE', 'CLINICAL_NOTES', 'MISCELLANEOUS'];
      const docType = validTypes.includes(documentType) ? documentType : 'MISCELLANEOUS';
      
      // Get content
      const contentResult = await this.model.generateContent([
        `This is a medical document classified as: ${docType}. ${contentPrompt}`,
        pdfPart
      ]);
      const docMarkdown = contentResult.response.text();
      
      // Get medications
      let medications = [];
      try {
        // Only extract medications if it's a prescription
        if (docType === 'PRESCRIPTION') {
          const medResult = await this.model.generateContent([
            medPrompt,
            pdfPart
          ]);
          
          // Try to parse medications as JSON
          const medText = medResult.response.text();
          // Find JSON array in the response (it might have additional text)
          const jsonMatch = medText.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            medications = JSON.parse(jsonMatch[0]);
          } else {
            console.warn('No JSON array found in medication response');
          }
          
          // Ensure medications is an array
          if (!Array.isArray(medications)) {
            medications = [];
          }
        }
      } catch (parseError) {
        console.warn('Failed to parse medications JSON:', parseError);
        medications = [];
      }
      
      return {
        document: docMarkdown,
        medications: medications,
        documentType: docType
      };
    } catch (error) {
      console.error('Error processing PDF with Gemini:', error);
      throw new Error(`Failed to process PDF with Gemini: ${error.message}`);
    }
  }
  
  /**
   * Process image file with Gemini AI
   * @param {string} base64Image - Base64-encoded image
   * @returns {Promise<Object>} - Processing results
   */
  async processImageWithGemini(base64Image) {
    try {
      // Create a content part for the image
      const imagePart = {
        inlineData: {
          data: base64Image.split(',')[1],
          mimeType: base64Image.split(',')[0].split(':')[1].split(';')[0]
        }
      };
      
      // Prompts for image processing
      const classifyPrompt = "Analyze this medical document image and classify it into exactly ONE of these categories: PRESCRIPTION, LAB_REPORT, INSURANCE, CLINICAL_NOTES, MISCELLANEOUS. Return ONLY the category name without any additional text or explanation.";
      
      const contentPrompt = "Simplify this medical document for a patient with no medical background. Transform complex medical information into clear, actionable insights anyone can understand. Format your response with these sections: # What This Means For You, # Key Actions, # Important Information, # Health Terms Simplified. Write at a 6th-grade reading level with short sentences and simple words. Focus on practical information, not technical details.";
      
      // Prompt for medication extraction
      const medPrompt = `
        Extract a comprehensive list of ALL medications visible in this medical document image.
        For each medication, provide the following information as a JSON object:
        
        1.  Name: An object containing:
            *   Generic: The generic name (e.g., "Metformin"). Provide null if not found.
            *   Brand: The brand name (e.g., "Glucophage"). Provide null if not found.
        2.  SuggestedName: IF AND ONLY IF both Generic and Brand names are null, provide a short, descriptive fallback name based on the medication's apparent use or type (e.g., "Pain Reliever", "Blood Pressure Pill", "Iron Supplement"). Otherwise, this field should be null or omitted.
        3.  Dosage: Dosage strength and form (e.g., "500mg tablet", "1 spray"). Provide null if not found.
        4.  Frequency: How often to take it (e.g., "Once daily", "Twice a day"). Provide null if not found.
        5.  Purpose: Briefly explain what symptom or condition it treats in patient-friendly terms. Provide null if not found.
        6.  Special Instructions: Extract any specific instructions like "Take with food", "Avoid alcohol", in simple language. 
            *   If instructions are found in the document: Provide them as a string.
            *   If a medication Name (Generic/Brand/Suggested) IS identified BUT specific instructions ARE NOT found in the document: Check your general knowledge for this medication. If common/important standard instructions exist (e.g., "Take levothyroxine on an empty stomach"), provide them as a string AND add a field "isGeneralKnowledgeInstructions: true". 
            *   Otherwise, provide null.
        7.  Important Side Effects: List serious or common side effects/warnings mentioned in the document.
            *   If side effects/warnings are found in the document: Provide them as a string.
            *   If a medication Name (Generic/Brand/Suggested) IS identified BUT specific side effects/warnings ARE NOT found in the document: Check your general knowledge for this medication. If well-known common or important side effects exist (e.g., "Metformin may cause digestive upset"), list 1-3 key ones as a string AND add a field "isGeneralKnowledgeSideEffects: true".
            *   Otherwise, provide null.

        Format the final output strictly as a JSON array containing these medication objects. Ensure all fields (e.g., "isGeneralKnowledgeInstructions") are included, set to "true" or "false"/"null" as appropriate.
        Make sure the output is ONLY the JSON array and nothing else before or after it.
      `;
      
      // Get document type
      const classifyResult = await this.model.generateContent([
        classifyPrompt,
        imagePart
      ]);
      const documentType = classifyResult.response.text().trim().toUpperCase();
      
      // Validate document type
      const validTypes = ['PRESCRIPTION', 'LAB_REPORT', 'INSURANCE', 'CLINICAL_NOTES', 'MISCELLANEOUS'];
      const docType = validTypes.includes(documentType) ? documentType : 'MISCELLANEOUS';
      
      // Get content
      const contentResult = await this.model.generateContent([
        `This is a medical document classified as: ${docType}. ${contentPrompt}`,
        imagePart
      ]);
      const docMarkdown = contentResult.response.text();
      
      // Get medications if it's a prescription
      let medications = [];
      try {
        if (docType === 'PRESCRIPTION') {
          const medResult = await this.model.generateContent([
            medPrompt,
            imagePart
          ]);
          
          // Try to parse medications as JSON
          const medText = medResult.response.text();
          // Find JSON array in the response (it might have additional text)
          const jsonMatch = medText.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            medications = JSON.parse(jsonMatch[0]);
          } else {
            console.warn('No JSON array found in medication response');
          }
          
          // Ensure medications is an array
          if (!Array.isArray(medications)) {
            medications = [];
          }
        }
      } catch (parseError) {
        console.warn('Failed to parse medications JSON:', parseError);
        medications = [];
      }
      
      return {
        document: docMarkdown,
        medications: medications,
        documentType: docType
      };
    } catch (error) {
      console.error('Error processing image with Gemini:', error);
      throw new Error(`Failed to process image with Gemini: ${error.message}`);
    }
  }

  /**
   * Extract medications from a document
   * @param {Object} docPart - Document content part
   * @returns {Promise<Array>} - Extracted medications
   */
  async _extractMedications(docPart) {
    // Prompt for medication extraction
    const medPrompt = `
      Extract a comprehensive list of ALL medications visible in this medical document.
      For each medication, provide the following information as a JSON object:
      
      1.  Name: An object containing:
          *   Generic: The generic name (e.g., "Metformin"). Provide null if not found.
          *   Brand: The brand name (e.g., "Glucophage"). Provide null if not found.
      2.  SuggestedName: IF AND ONLY IF both Generic and Brand names are null, provide a short, descriptive fallback name based on the medication's apparent use or type (e.g., "Pain Reliever", "Blood Pressure Pill", "Iron Supplement"). Otherwise, this field should be null or omitted.
      3.  Dosage: Dosage strength and form (e.g., "500mg tablet", "1 spray"). Provide null if not found.
      4.  Frequency: How often to take it (e.g., "Once daily", "Twice a day"). Provide null if not found.
      5.  Purpose: Briefly explain what symptom or condition it treats in patient-friendly terms. Provide null if not found.
      6.  Special Instructions: Extract any specific instructions like "Take with food", "Avoid alcohol", in simple language. 
          *   If instructions are found in the document: Provide them as a string.
          *   If a medication Name (Generic/Brand/Suggested) IS identified BUT specific instructions ARE NOT found in the document: Check your general knowledge for this medication. If common/important standard instructions exist (e.g., "Take levothyroxine on an empty stomach"), provide them as a string AND add a field "isGeneralKnowledgeInstructions: true". 
          *   Otherwise, provide null.
      7.  Important Side Effects: List serious or common side effects/warnings mentioned in the document.
          *   If side effects/warnings are found in the document: Provide them as a string.
          *   If a medication Name (Generic/Brand/Suggested) IS identified BUT specific side effects/warnings ARE NOT found in the document: Check your general knowledge for this medication. If well-known common or important side effects exist (e.g., "Metformin may cause digestive upset"), list 1-3 key ones as a string AND add a field "isGeneralKnowledgeSideEffects: true".
          *   Otherwise, provide null.

      Format the final output strictly as a JSON array containing these medication objects. Ensure all fields (e.g., "isGeneralKnowledgeInstructions") are included, set to "true" or "false"/"null" as appropriate.
      Make sure the output is ONLY the JSON array and nothing else before or after it.
    `;
    
    try {
      const medResult = await this.model.generateContent([medPrompt, docPart]);
      
      // Try to parse medications as JSON
      const medText = medResult.response.text();
      // Find JSON array in the response (it might have additional text)
      const jsonMatch = medText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      
      console.warn('No JSON array found in medication response');
      return [];
    } catch (parseError) {
      console.warn('Failed to parse medications JSON:', parseError);
      return [];
    }
  }
  
  /**
   * Simplify text for patient understanding
   * @param {Document} document - Document model instance
   * @param {string} text - Extracted text content
   * @param {Object} analysis - Analysis results
   * @returns {Promise<string>} - Simplified text
   */
  async simplifyText(document, text, analysis) {
    console.log(`Simplifying text for ${document.fileName || 'unnamed'} using Gemini`);
    
    try {
      const { base64Data, mimeType } = await this._documentToBase64(document);
      
      // Create content parts for the document
      const docPart = {
        inlineData: {
          data: base64Data,
          mimeType
        }
      };
      
      const contentPrompt = "Simplify this medical document for a patient with no medical background. Transform complex medical information into clear, actionable insights anyone can understand. Format your response with these sections: # What This Means For You, # Key Actions, # Important Information, # Health Terms Simplified. Write at a 6th-grade reading level with short sentences and simple words. Focus on practical information, not technical details.";
      
      const contentResult = await this.model.generateContent([
        `This is a medical document classified as: ${analysis.documentType}. ${contentPrompt}`,
        docPart
      ]);
      
      return contentResult.response.text();
    } catch (error) {
      console.error('Error simplifying text with Gemini:', error);
      return "We couldn't simplify this document. Please try again later or consult your healthcare provider for an explanation.";
    }
  }
}

export default GeminiDocumentProcessor; 