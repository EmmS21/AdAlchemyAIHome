import React, { useState, useEffect } from 'react';
import { z } from 'zod';

const campaignSchema = z.object({
  campaignName: z.string().min(1, "Campaign Name is required"),
  dailyBudget: z.string().min(1, "Daily Budget is required"),
  startDate: z.string().min(1, "Start Date is required"),
  endDate: z.string().min(1, "End Date is required"),
});

interface NewCampaignModalProps {
  show: boolean;
  onClose: () => void;
  onSubmit: () => void;
  campaignData: {
    campaignName: string;
    dailyBudget: string;
    startDate: string;
    endDate: string;
  };
  setCampaignData: React.Dispatch<React.SetStateAction<{
    campaignName: string;
    dailyBudget: string;
    startDate: string;
    endDate: string;
  }>>;
}

const NewCampaignModal: React.FC<NewCampaignModalProps> = ({
  show,
  onClose,
  onSubmit,
  campaignData,
  setCampaignData
}) => {
  const [errors, setErrors] = useState<{ [key: string]: string[] }>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!show) {
      setErrors({});
      setIsSubmitting(false);
    }
  }, [show]);

  const handleSubmit = () => {
    console.log('****')
    const result = campaignSchema.safeParse(campaignData);
    if (result.success) {
      setErrors({});
      onSubmit();
    } else {
      setErrors(result.error.flatten().fieldErrors);
    }
    setIsSubmitting(false);
  };

  if (!show) return null;

  return (
    <div className="modal">
      <div className="modal-content">
        <h2>Create New Campaign 22</h2>
        <input
          type="text"
          placeholder="Campaign Name"
          value={campaignData.campaignName}
          onChange={(e) => setCampaignData({...campaignData, campaignName: e.target.value})}
        />
        {errors.campaignName && <span className="error">{errors.campaignName[0]}</span>}
        <input
          type="number"
          placeholder="Daily Budget"
          value={campaignData.dailyBudget}
          onChange={(e) => setCampaignData({...campaignData, dailyBudget: e.target.value})}
        />
        {errors.dailyBudget && <span className="error">{errors.dailyBudget[0]}</span>}
        <input
          type="date"
          placeholder="Start Date"
          value={campaignData.startDate}
          onChange={(e) => setCampaignData({...campaignData, startDate: e.target.value})}
        />
        {errors.startDate && <span className="error">{errors.startDate[0]}</span>}
        <input
          type="date"
          placeholder="End Date"
          value={campaignData.endDate}
          onChange={(e) => setCampaignData({...campaignData, endDate: e.target.value})}
        />
        {errors.endDate && <span className="error">{errors.endDate[0]}</span>}
        <button onClick={handleSubmit} disabled={isSubmitting}>
          {isSubmitting ? 'Creating...' : 'Create Campaign'}
        </button>
        <button onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
};

export default NewCampaignModal;