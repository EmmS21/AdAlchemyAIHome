import React, { useState } from 'react';
import '../App.css'

interface CustomerIdModalProps {
  show: boolean;
  onClose: () => void;
  onSubmit: (customerId: string) => void;
}

const CustomerIdModal: React.FC<CustomerIdModalProps> = ({ show, onClose, onSubmit }) => {
  const [customerId, setCustomerId] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(customerId);
    setCustomerId('');
  };

  if (!show) {
    return null;
  }

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <h2>Your Google Ads Customer ID
          <div className="tooltip">
              <span className="tooltip-text">
                Here's how to find your Google Ads customer ID:
                <a 
                  href="https://support.google.com/google-ads/answer/1704344?hl=en" 
                  target="_blank" 
                  rel="noopener noreferrer"
                >
                  Click here for instructions
                </a>
              </span>
            </div>
        </h2>
        <form onSubmit={handleSubmit}>
          <input
            type="text"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            placeholder="Enter your Customer ID"
            required
          />
          <div className="modal-buttons">
            <button type="submit">Submit</button>
            <button type="button" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CustomerIdModal;