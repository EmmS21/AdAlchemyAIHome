import React, { useState, useRef } from 'react';
import '../App.css'

interface AssetModalProps {
  show: boolean;
  onClose: () => void;
  onSubmit: (images: File[]) => void;
}

const AssetModal: React.FC<AssetModalProps> = ({
  show,
  onClose,
  onSubmit,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [showImageField, setShowImageField] = useState(true);
  const [isUploading, setIsUploading] = useState(false); 
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!show) return null;

  const API_URL = import.meta.env.MODE === 'production' 
  ? import.meta.env.VITE_API_URL_PROD 
  : import.meta.env.VITE_API_URL_DEV;


  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) {
      handleFiles(Array.from(e.dataTransfer.files));
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleFiles(Array.from(e.target.files));
    }
  };

  const handleFiles = (files: File[]) => {
    const imageFiles = files.filter(file => file.type.startsWith('image/'));
    setUploadedFiles(prevFiles => [...prevFiles, ...imageFiles]);
  };

  const handleBrowseClick = () => {
    fileInputRef.current?.click();
  };

  const handleRemoveFile = (index: number) => {
    setUploadedFiles(prevFiles => prevFiles.filter((_, i) => i !== index));
  };


const handleSubmit = async () => {
  setIsUploading(true); 
  try {
    const storedCampaign = localStorage.getItem('selectedCampaign');
    const storedAnalysis = localStorage.getItem('Analysis');
    const businessName = storedAnalysis ? JSON.parse(storedAnalysis).businessName : '';
    const campaignName = storedCampaign ? JSON.parse(storedCampaign).name : 'Default Campaign Name';

    if (showImageField && uploadedFiles.length > 0) {
      // Upload images
      for (const file of uploadedFiles) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('business_name', businessName);
        formData.append('campaignName', campaignName)

        // Debugging: Log the file object and FormData entries
        console.log('File object:', file);
        for (const pair of formData.entries()) {
          console.log(pair[0] + ': ' + pair[1]);
        }  

        const imageResponse = await fetch(`${API_URL}/upload_logo`, {
          method: 'POST',
          body: formData,
        });

        if (!imageResponse.ok) {
          const errorData = await imageResponse.json();
          console.log('error', errorData)
          throw new Error(`Failed to upload image: ${JSON.stringify(errorData)}`);
        }

        console.log(`Image ${file.name} uploaded successfully`);
      }
    }

    // If everything is successful, call the onSubmit prop and close the modal
    onSubmit(uploadedFiles);
    onClose();
    console.log('All assets uploaded successfully');
  } catch (error) {
    console.error('Error uploading assets:', error);
    alert(`Failed to upload assets: ${(error as Error).message}`);
  } finally {
    setIsUploading(false); 
    setUploadedFiles([]); 
    setShowImageField(true); 
  }
};

  const toggleImageField = () => {
    setShowImageField(!showImageField);
    if (!showImageField) {
      setUploadedFiles([]);
    }
  };

  return (
    <div className="asset-modal">
      <div className="asset-modal-content">
        <h2>Add Assets to Ads</h2>
        <div className={`asset-input ${showImageField ? 'show' : 'hide'}`}>
          {showImageField ? (
            <>
              <div 
                className={`drag-drop-area ${isDragging ? 'dragging' : ''}`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                <div className="drag-drop-content">
                  <span className="upload-icon">↑</span>
                  <p>Drag and drop files here</p>
                  <p>or</p>
                  <button onClick={handleBrowseClick} className="browse-button">Browse for files</button>
                </div>
                <input
                  type="file"
                  ref={fileInputRef}
                  style={{ display: 'none' }}
                  multiple
                  onChange={handleFileChange}
                  accept="image/*"
                />
              </div>
              {uploadedFiles.length > 0 && (
                <div className="file-list">
                  {uploadedFiles.map((file, index) => (
                    <div key={index} className="file-item">
                      <span className="file-name">{file.name}</span>
                      <span className="file-size">{(file.size / 1024).toFixed(2)} KB</span>
                      <button onClick={() => handleRemoveFile(index)} className="remove-file">×</button>
                    </div>
                  ))}
                </div>
              )}
              <button onClick={toggleImageField} className="remove-image">×</button>
            </>
          ) : (
            <button onClick={toggleImageField} className="add-image">+</button>
          )}
        </div>
        <div className="asset-modal-buttons">
          <button onClick={handleSubmit} disabled={isUploading}>
            {isUploading ? 'Uploading...' : 'Add Assets'}
          </button>
          <button onClick={onClose} disabled={isUploading}>Cancel</button>
        </div>
        {isUploading && <div className="spinner"></div>}
      </div>
    </div>
  );
};

export default AssetModal;