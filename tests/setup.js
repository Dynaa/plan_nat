// Configuration globale pour les tests
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-secret-key';

// Désactiver les logs pendant les tests
console.log = jest.fn();
console.error = jest.fn();
console.warn = jest.fn();

// Mock des emails pour les tests
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: {
      send: jest.fn().mockResolvedValue({ data: { id: 'test-email-id' } })
    }
  }))
}));

// Mock de nodemailer
jest.mock('nodemailer', () => ({
  createTransporter: jest.fn(),
  createTestAccount: jest.fn().mockResolvedValue({
    user: 'test@ethereal.email',
    pass: 'test-password'
  })
}));