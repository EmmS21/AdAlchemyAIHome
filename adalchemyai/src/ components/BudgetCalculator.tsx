import React, { useState, useEffect } from 'react';

interface BudgetCalculatorProps {
  onConsent: (budget: number, fee: number) => void;
  onReject: () => void;
}

const BudgetCalculator: React.FC<BudgetCalculatorProps> = ({ onConsent, onReject }) => {
  const [budget, setBudget] = useState<number>(0);
  const [fee, setFee] = useState<number>(0);

  useEffect(() => {
    calculateFee(budget);
  }, [budget]);

  const calculateFee = (amount: number) => {
    let feePercentage;
    if (amount <= 100) {
      feePercentage = 0.10;
    } else if (amount <= 499) {
      feePercentage = 0.075;
    } else {
      feePercentage = 0.05;
    }
    setFee(amount * feePercentage);
  };

  const handleConsent = () => {
    onConsent(budget, fee);
  };

  return (
    <div className="budget-calculator">
      <input
        type="number"
        value={budget}
        onChange={(e) => setBudget(Number(e.target.value))}
        placeholder="Enter your monthly ad budget"
        className="budget-input"
      />
      <p className="fee-display">Your monthly fee: ${fee.toFixed(2)}</p>
      <div className="button-group">
        <button onClick={handleConsent} className="consent-button">Proceed</button>
        <button onClick={onReject} className="reject-button">Decline</button>
      </div>
    </div>
  );
};

export default BudgetCalculator;