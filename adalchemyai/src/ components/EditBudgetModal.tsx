import React, { useState, useEffect } from 'react';
import '../App.css'

interface EditBudgetModalProps {
  show: boolean;
  onClose: () => void;
  onSubmit: (newBudget: number) => void;
  campaignName: string;
  currentBudget: number | null;
}

const EditBudgetModal: React.FC<EditBudgetModalProps> = ({ show, onClose, onSubmit, campaignName, currentBudget }) => {
  const [newBudget, setNewBudget] = useState<string>('');

  useEffect(() => {
    if (currentBudget !== null) {
      setNewBudget(currentBudget.toString());
    }
  }, [currentBudget]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const budgetValue = parseFloat(newBudget);
    if (!isNaN(budgetValue) && budgetValue > 0) {
      onSubmit(budgetValue);
    }
  };

  if (!show) return null;

  return (
    <div className="edit-budget-modal">
      <div className="edit-budget-modal-content">
        <h2>Edit Campaign Budget</h2>
        <p>Campaign: {campaignName}</p>
        <form onSubmit={handleSubmit}>
          <label htmlFor="budget">Daily Budget (USD):</label>
          <input
            type="number"
            id="budget"
            value={newBudget}
            onChange={(e) => setNewBudget(e.target.value)}
            min="0"
            step="0.01"
            required
          />
          <div className="edit-budget-modal-buttons">
            <button type="submit">Update Budget</button>
            <button type="button" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default EditBudgetModal;