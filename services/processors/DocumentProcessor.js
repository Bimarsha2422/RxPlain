import { Groq } from 'groq-sdk';
import BaseDocumentProcessor from './BaseDocumentProcessor.js';

/**
 * Document processor implementation using Groq API
 * Used as a fallback when Gemini is not preferred
 */
class DocumentProcessor extends BaseDocumentProcessor {
  /**
   * Create a new DocumentProcessor
   * @param {string} apiKey - Groq API key (optional, will use env var if not provided)
   */
  constructor(apiKey) {
    super();
    this.groq = new Groq({
      apiKey: apiKey || process.env.GROQ_API_KEY
    });
  }

  /**
   * Extract text from a document
   * @param {Document} document - Document model instance
   * @returns {Promise<string>} - Extracted text
   */
  async extractText(document) {
    console.log(`Extracting text from ${document.fileName} using Groq (note: this is a limited fallback processor)`);
    
    // In a real implementation, you would extract text from the document
    // For now, we'll just return a message about the fallback implementation
    return `This is placeholder text for ${document.fileName}. The Groq processor doesn't handle document file extraction directly. Please use GeminiDocumentProcessor for full functionality.`;
  }
  
  /**
   * Analyze a document and classify it
   * @param {Document} document - Document model instance
   * @param {string} text - Extracted text content
   * @returns {Promise<Object>} - Analysis results
   */
  async analyzeDocument(document, text) {
    console.log(`Analyzing document ${document.fileName} using Groq`);
    
    try {
      const prompt = `Analyze this medical document text and classify it into one of these categories: PRESCRIPTION, LAB_REPORT, INSURANCE, CLINICAL_NOTES, MISCELLANEOUS. 
      
      Text to analyze: "${text.substring(0, 2000)}..."
      
      Respond ONLY with the category name.`;
      
      const completion = await this.groq.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
        model: 'mixtral-8x7b-32768',
        temperature: 0.3,
        max_tokens: 256,
      });
      
      const documentType = completion.choices[0]?.message?.content?.trim().toUpperCase() || 'MISCELLANEOUS';
      
      // Valid document types
      const validTypes = ['PRESCRIPTION', 'LAB_REPORT', 'INSURANCE', 'CLINICAL_NOTES', 'MISCELLANEOUS'];
      const docType = validTypes.includes(documentType) ? documentType : 'MISCELLANEOUS';
      
      return {
        documentType: docType,
        medications: [] // Groq processor doesn't extract medications
      };
    } catch (error) {
      console.error('Error analyzing document with Groq:', error);
      return {
        documentType: 'MISCELLANEOUS',
        medications: []
      };
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
    console.log(`Simplifying text for ${document.fileName} using Groq`);
    
    const prompt = `Please analyze the following medical document text and provide a structured response with these sections:
    1. Summary: A clear, concise summary of the key points
    2. Medical Terms: Explanation of complex medical terms in simple language
    3. Medications: List and explanation of any medications mentioned
    4. Recommendations: Key recommendations or next steps
    5. Warnings: Any important warnings or contraindications

    Text to analyze:
    ${text.substring(0, 4000)}...`;

    try {
      const completion = await this.groq.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
        model: 'mixtral-8x7b-32768',
        temperature: 0.3,
        max_tokens: 2048,
      });

      return completion.choices[0]?.message?.content || 'No analysis available';
    } catch (error) {
      console.error('Error with Groq API:', error);
      return "We couldn't simplify this document. Please try again later or consult your healthcare provider for an explanation.";
    }
  }
}

export default DocumentProcessor; 