/**
 * Simple dependency injection container
 */
class Container {
  constructor() {
    this._registrations = new Map();
    this._instances = new Map();
  }
  
  /**
   * Register a factory function for a dependency
   * @param {string} name - Service name
   * @param {Function} factory - Factory function
   */
  register(name, factory) {
    this._registrations.set(name, { factory });
  }
  
  /**
   * Register an instance directly (singleton)
   * @param {string} name - Service name
   * @param {any} instance - Service instance
   */
  registerInstance(name, instance) {
    this._instances.set(name, instance);
  }
  
  /**
   * Resolve a service
   * @param {string} name - Service name
   * @returns {any} - Service instance
   */
  resolve(name) {
    // Return existing instance if available
    if (this._instances.has(name)) {
      return this._instances.get(name);
    }
    
    // Get registration
    const registration = this._registrations.get(name);
    if (!registration) {
      throw new Error(`Service not registered: ${name}`);
    }
    
    // Create instance
    const instance = registration.factory(this);
    
    // Cache instance for reuse
    this._instances.set(name, instance);
    
    return instance;
  }
}

export default Container; 