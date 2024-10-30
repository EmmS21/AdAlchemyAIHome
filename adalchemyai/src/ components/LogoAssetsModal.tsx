import React, { useState, useEffect } from 'react';
import '../App.css';

interface LogoAssetsModalProps {
  show: boolean;
  onClose: () => void;
  assets: { url: string }[];
  onSelect: (asset: string) => void;
}

const LogoAssetsModal: React.FC<LogoAssetsModalProps> = ({ show, onClose, assets, onSelect }) => {
    const [selectedAsset, setSelectedAsset] = useState<string | null>(null);

    useEffect(() => {
        if (!show) {
          setSelectedAsset(null); 
        }
    }, [show]);

    if (!show) return null;

    const handleSelect = (url: string) => {
        if (selectedAsset === url) {
          setSelectedAsset(null); 
        } else {
          setSelectedAsset(url); 
        }
      };
    
      const handleButtonClick = () => {
        if (selectedAsset) {
          onSelect(selectedAsset);
        }
        onClose();
      };

    return (
        <div className="logo-assets-modal">
            <div className="logo-assets-content">
                <h2>Select a Logo</h2>
                <div className="logo-grid">
                {assets.map((asset, index) => (
                    <div key={index} 
                    className={`logo-item ${selectedAsset === asset.url ? 'selected' : ''}`}
                    onClick={() => handleSelect(asset.url)}
                    >
                    <img src={asset.url} alt={`Logo ${index + 1}`} />
                    </div>
                ))}
                </div>
                <button onClick={handleButtonClick} className="close-modal-button">
                    {selectedAsset ? 'Select' : 'Close'}
                </button>
            </div>
        </div>
    );
};

export default LogoAssetsModal;