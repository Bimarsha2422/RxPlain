/**
 * Base class for document processors
 * Defines the interface that all document processors must implement
 */
class BaseDocumentProcessor {
  /**
   * Extract text from a document
   * @param {Document} document - Document model instance
   * @returns {Promise<string>} - Extracted text
   */
  async extractText(document) {
    throw new Error('Method not implemented: extractText');
  }
  
  /**
   * Analyze a document and classify it
   * @param {Document} document - Document model instance
   * @param {string} text - Extracted text content
   * @returns {Promise<Object>} - Analysis results
   */
  async analyzeDocument(document, text) {
    throw new Error('Method not implemented: analyzeDocument');
  }
  
  /**
   * Simplify text for patient understanding
   * @param {Document} document - Document model instance
   * @param {string} text - Extracted text content
   * @param {Object} analysis - Analysis results
   * @returns {Promise<string>} - Simplified text
   */
  async simplifyText(document, text, analysis) {
    throw new Error('Method not implemented: simplifyText');
  }

  /**
   * Complete document processing in a single call
   * @param {Document} document - Document model instance
   * @returns {Promise<Object>} - Processing results
   */
  async processDocument(document) {
    const text = await this.extractText(document);
    const analysis = await this.analyzeDocument(document, text);
    const simplifiedText = await this.simplifyText(document, text, analysis);
    
    return {
      success: true,
      extractedText: text,
      analysis,
      document: simplifiedText,
      medications: analysis.medications || [],
      documentType: analysis.documentType || 'MISCELLANEOUS'
    };
  }
}

export default BaseDocumentProcessor; 