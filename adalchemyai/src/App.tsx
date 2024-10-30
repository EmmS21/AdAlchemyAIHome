import React, { useState, useEffect, useRef, useContext } from 'react';
import './App.css';
import logo from './assets/adalch.jpg';
import useTypingEffect from './hooks/useTypingEffect';
import { getAuth, signInWithPopup, GoogleAuthProvider, User } from 'firebase/auth';
import { initializeApp } from 'firebase/app';
import AssetModal from './ components/AssetModal';
import LogoAssetsModal from './ components/LogoAssetsModal';
import EditBudgetModal from './ components/EditBudgetModal';
import NewCampaignModal from './ components/NewCampaignModal';
import { SyncLoader } from 'react-spinners';
import CustomerIdModal from './ components/CustomerIdModal';
import { AuthContext } from './contexts/AuthContext';
import { z } from 'zod';
import { loadStripe } from '@stripe/stripe-js';

interface UserPersona {
  name: string;
  description: string;
}

interface SelectedAd {
  headlines: string[];
  descriptions: string[];
  website?: string;
  keywords?: string[];
  related_keywords?: string[];
  additional_headlines?: string[];
  additional_descriptions?: string[];
  currentHeadlineIndex: number;
  currentDescriptionIndex: number;
  logo?: string | null;
  imageAsset?: string | null;  
  image?: string | null;  
}


interface AnalysisResult {
  businessName: string;
  marketingData: {
    business: string;
    date_written: { year: number; month: number; day: number };
    list_of_ad_text: { headlines: string[]; descriptions: string[] };
    list_of_keywords: string[];
    list_of_paths_taken: string[];
    user_personas: UserPersona[];
    last_update: string;
  };
}

interface AdDescription {
  text: string;
  finalized: boolean;
  new?: boolean;
}

interface Keyword {
  keyword: string;
  search_volume: string;
  competitiveness: string;
  new?: boolean;
}

interface AdHeadline {
  text: string;
  finalized: boolean;
  new?: boolean;
}

type SidebarContent = 'test' | 'info' | 'authenticated' | 'loggedIn' | 'success' | 'onboarding' | null;

type AdCreationStep = 
  | 'initial'
  | 'checkCredentials'
  | 'requiresAuth'
  | 'authenticating'
  | 'selectCampaignOption'
  | 'loadingCampaigns'
  | 'selectExistingCampaign'
  | 'createNewCampaign'
  | 'displaySelectedAds'
  | 'error';

console.log('Environment:', import.meta.env.MODE);
console.log('Firebase API Key exists:', !!import.meta.env.VITE_FIREBASE_API_KEY);

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL
};

const campaignSchema = z.object({
  campaignName: z.string().min(1, "Campaign Name is required"),
  dailyBudget: z.string().min(1, "Daily Budget is required"),
  startDate: z.string().min(1, "Start Date is required"),
  endDate: z.string().min(1, "End Date is required"),
});

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);

function App() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    const storedState = localStorage.getItem('currSideBarState');
    if (storedState) {
      const parsedState = JSON.parse(storedState);
      return parsedState.isOpen;
    }
    return false;
  });
  const [sidebarContent, setSidebarContent] = useState<SidebarContent>(() => {
    const storedState = localStorage.getItem('currSideBarState');
    if (storedState) {
      const parsedState = JSON.parse(storedState);
      return parsedState.content;
    }
    return null;
  });
  const [sessionId, setSessionId] = useState<string | null>(() => {
    return localStorage.getItem('currSessionId') || null;
  });
  const [messages, setMessages] = useState<Array<{ content: string, isBot: boolean }>>(() => {
    const storedMessages = localStorage.getItem('chatMessages');
      if (storedMessages) {
        return JSON.parse(storedMessages);
      }
    return [];
  });
  const [isLoading, setIsLoading] = useState(false);
  const [showYesNo, setShowYesNo] = useState(false);
  const [faqContent, setFaqContent] = useState<string | null>(null);
  const [analysisStarted, setAnalysisStarted] = useState(false);
  const [remainingTime, setRemainingTime] = useState(240); 
  const [currentThinkingStep, setCurrentThinkingStep] = useState('');
  const [businessName, setBusinessName] = useState(() => {
    const userData = localStorage.getItem('user');
    if (userData) {
      const parsedUserData = JSON.parse(userData);
      return parsedUserData.businessName || '';
    }
    return '';
  });
  const updateBusinessName = (newName: string) => {
    setBusinessName(newName);
  };

  const [businessDescription, setBusinessDescription] = useState(() => {
    const userData = localStorage.getItem('user');
    if (userData) {
      const parsedUserData = JSON.parse(userData);
      return parsedUserData.businessDescription || '';
    }
    return '';
  });
  const [analysisResults, setAnalysisResults] = useState<AnalysisResult | null>(() => {
    const storedAnalysis = localStorage.getItem('Analysis');
    return storedAnalysis ? JSON.parse(storedAnalysis) : null;
  });
  const [selectedSection, setSelectedSection] = useState<string | null>(null);
  const currentAdVariation = 0;
  const [editedHeadlines, setEditedHeadlines] = useState<string[]>([]);
  const [editedDescriptions, setEditedDescriptions] = useState<string[]>([]);
  const [selectedKeywords, setSelectedKeywords] = useState<Set<string>>(new Set());
  const [showCustomerIdModal, setShowCustomerIdModal] = useState(false);

  const [researchPaths, setResearchPaths] = useState<string[]>([]);
  const [newPath, setNewPath] = useState('');
  const [editedPersonas, setEditedPersonas] = useState<{ name: string, description: string }[]>([]);
  const [showLoginButton, setShowLoginButton] = useState(() => {
    const storedShowLoginButton = localStorage.getItem('showLoginButton');
    return storedShowLoginButton ? JSON.parse(storedShowLoginButton) : false;
  });
  const [alertMessage, setAlertMessage] = useState(() => {
    return localStorage.getItem('alertMessage') || '';
  });
  const [userLoggedIn, setUserLoggedIn] = useState(() => {
    return localStorage.getItem('userLoggedIn');
  })
  const [adCreationStep, setAdCreationStep] = useState<AdCreationStep>(() => {
    const savedStep = localStorage.getItem('adCreationStep');
    return savedStep ? (savedStep as AdCreationStep) : 'initial';
  });
  const [isCreatingAds, setIsCreatingAds] = useState(false);
  const [createAdSpinner, setCreateAdSpinner] = useState(false);
  const [onboardingMessage, setOnboardingMessage] = useState<string>('');
  const { user, loading } = useContext(AuthContext);
  const [errors, setErrors] = useState<{ [key: string]: string[] }>({});
  const [isInputDisabled, setIsInputDisabled] = useState(false);

  const updateAdCreationStep = (step: AdCreationStep) => {
    setAdCreationStep(step);
    localStorage.setItem('adCreationStep', step);
  };

  const [selectedCampaign, setSelectedCampaign] = useState<{ id: string, name: string } | null>(null);
  const [campaigns, setCampaigns] = useState<Array<{
    'Campaign ID': number,
    'Campaign Name': string,
    'Budget': number
  }>>([]);
  const [isLoadingCampaigns, setIsLoadingCampaigns] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  
  const [authenticationTimer, setAuthenticationTimer] = useState(0);
  const [selectedAds, setSelectedAds] = useState<SelectedAd[]>(() => {
    const savedAds = localStorage.getItem('selectedAds');
    return savedAds ? JSON.parse(savedAds) : [];
  });
    const [googleDoodleUrl, setGoogleDoodleUrl] = useState<string | null>(null);
  const [editingAdIndex, setEditingAdIndex] = useState<number | null>(null);
  const [editedAds, setEditedAds] = useState<SelectedAd[] | null>([]);
  const [approvedAds, setApprovedAds] = useState<Set<number>>(new Set());
  const [adsMarkedForDeletion, setAdsMarkedForDeletion] = useState<Set<number>>(new Set());
  const [, setLogos] = useState<{ [key: number]: string }>({});
  const [, setIsEditMode] = useState<boolean>(false); 

  const [showAssetModal, setShowAssetModal] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null);
  const [showLogoGrid, setShowLogoGrid] = useState(false);
  const [showLogoAssetsModal, setShowLogoAssetsModal] = useState(false);
  const [logoAssets, setLogoAssets] = useState<string[]>([]);

  const [showBudgetModal, setShowBudgetModal] = useState(false);
  const [currentBudget, setCurrentBudget] = useState<number | null>(null);
  // const [, setIsLoadingBudget] = useState(false);

  const [showNewCampaignModal, setShowNewCampaignModal] = useState(false);
  const [newCampaignData, setNewCampaignData] = useState({
    campaignName: '',
    dailyBudget: '',
    startDate: '',
    endDate: ''
  });
  const [, setIsCreatingCampaign] = useState(false);
  const [analysisInProgress, setAnalysisInProgress] = useState(false);
  const currentAnalysisStep = '';
  const [, setAnalysisResultsLoaded] = useState(false);
  const [isGeneratingOutput, setIsGeneratingOutput] = useState(false);

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

const handleLogout = async () => {
  try {
    await auth.signOut();
    updateBusinessName('');
    setBusinessDescription('');
    setShowLoginButton(true);
    setAlertMessage('');
    setShowLoginButton(false);
    setSessionId(null);
    setAnalysisResults(null);
    setSelectedAds([]);
    setSelectedCampaign(null);
    setAdCreationStep('initial');
    setMessages([]);
    // Close the sidebar
    setIsSidebarOpen(false);
    setSidebarContent(null);
    setUserLoggedIn('');
    localStorage.clear();
    // Clear URL parameters
    const newUrl = window.location.origin + window.location.pathname;
    window.history.pushState({}, '', newUrl);
  } catch (error) {
    console.error('Error signing out:', error);
    setAlertMessage('Failed to log out. Please try again.');
  }
};

const cycleHeadline = (adIndex: number, direction: number) => {
  const newAds = [...selectedAds];
  const ad = newAds[adIndex];
  const totalHeadlines = ad.headlines.length + (ad.additional_headlines?.flat().length || 0);
  ad.currentHeadlineIndex = ((ad.currentHeadlineIndex || 0) + direction + totalHeadlines) % totalHeadlines;
  setSelectedAds(newAds);
};

const cycleDescription = (adIndex: number, direction: number) => {
  const newAds = [...selectedAds];
  const ad = newAds[adIndex];
  const totalDescriptions = ad.descriptions.length + (ad.additional_descriptions?.flat().length || 0);
  ad.currentDescriptionIndex = ((ad.currentDescriptionIndex || 0) + direction + totalDescriptions) % totalDescriptions;
  setSelectedAds(newAds);
};

useEffect(() => {
  if (adCreationStep === 'selectExistingCampaign') {
    fetchExistingCampaigns();
  }
}, [adCreationStep]);

useEffect(() => {
  const storedState = localStorage.getItem('sidebarState');
  if (storedState) {
    const { isOpen, content } = JSON.parse(storedState);
    setIsSidebarOpen(isOpen);
    setSidebarContent(content);
  }

  const showLoginButton = localStorage.getItem('showLoginButton');
  const selectedCampaign = localStorage.getItem('selectedCampaign');
  const logos = localStorage.getItem('logos');
  const businessDescription = localStorage.getItem('businessDescription');
  const step = localStorage.getItem('step');
  const storedStep = localStorage.getItem('adCreationStep');

  if (step === "selectCampaignOption") {
    setSidebarContent('authenticated');
    updateAdCreationStep('selectCampaignOption');
  } else if(storedStep) {
    updateAdCreationStep(storedStep as AdCreationStep);
  } else if (step) {
    updateAdCreationStep(step as AdCreationStep);
  }

  // if (step) updateAdCreationStep(step as any);
  if (businessDescription) setBusinessDescription(businessDescription);
  if (showLoginButton) setShowLoginButton(showLoginButton === 'true');
  if (selectedCampaign) setSelectedCampaign(JSON.parse(selectedCampaign));
  if (logos) setLogos(JSON.parse(logos));

  if (selectedAds.length > 0) {
    const newAds = selectedAds.map(ad => ({
      ...ad,
      headlines: [...ad.headlines, ...(ad.additional_headlines?.flat() || [])],
      descriptions: [...ad.descriptions, ...(ad.additional_descriptions?.flat() || [])],
      currentHeadlineIndex: 0,
      currentDescriptionIndex: 0
    }));
    setSelectedAds(newAds);
  }

  const urlParams = new URLSearchParams(window.location.search);
  const paymentSuccessExisting = urlParams.get('payment_success_existing');

  if (paymentSuccessExisting === 'true') {
    const storedAnalysis = localStorage.getItem('Analysis');
    if (!storedAnalysis) {
      console.error('No analysis data found in localStorage');
      return;
    }
    const parsedAnalysis = JSON.parse(storedAnalysis);
    setAnalysisResults(parsedAnalysis);
    const storedData = localStorage.getItem('pendingAdCreation');
    if (storedData) {
      const { approvedAds, selectedAds, adCreationStep, campaignName } = JSON.parse(storedData);
      setApprovedAds(new Set(approvedAds));
      setSelectedAds(selectedAds);
      updateAdCreationStep(adCreationStep);
      
      // Continue with ad creation
      createGoogleAds(approvedAds, selectedAds, campaignName, parsedAnalysis);

      // Clear the stored data
      localStorage.removeItem('pendingAdCreation');
    } else {
      console.error('No pending ad creation data found');
      alert('An error occurred while creating ads. Please try again.');
    }
    // Clear the URL parameters
    window.history.replaceState({}, document.title, window.location.pathname);
  }
  // Load campaigns from localStorage on component mount
  const storedCampaigns = localStorage.getItem('campaigns');
  if (storedCampaigns) {
    setCampaigns(JSON.parse(storedCampaigns));
  }
}, []);

useEffect(() => {
  localStorage.setItem('currSideBarState', JSON.stringify({ 
    content: sidebarContent, 
    isOpen: isSidebarOpen 
  }));
}, [sidebarContent, isSidebarOpen]);

useEffect(() => {
  if (sessionId && messages.length > 0) {
    localStorage.setItem('chatMessages', JSON.stringify(messages));
  }
}, [sessionId, messages]);

const startAdCreation = async () => {
  updateAdCreationStep('checkCredentials');
  const storedAnalysis = localStorage.getItem('Analysis')!;
  const parsedAnalysis = JSON.parse(storedAnalysis);

  try {
    const response = await fetch(`${API_URL}/initAdCreation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ businessName: parsedAnalysis?.businessName }),
    });
    const data = await response.json();
    
    if (data.success) {
      if (data.requiresCredentials) {
        await handleGoogleAdsLogin();
      } else if (data.message === 'Credentials found. Ready to authenticate.') {
        setIsAuthenticating(true);
        setAuthenticationTimer(0);
        const timerInterval = setInterval(() => {
          setAuthenticationTimer(prev => prev + 1);
        }, 1000);

        updateAdCreationStep('authenticating');
        const authResult = await authenticate();
        
        clearInterval(timerInterval);
        setIsAuthenticating(false);

        if ((authResult as unknown as { success: boolean }).success) {
          updateAdCreationStep('selectCampaignOption');
        } else {
          updateAdCreationStep('requiresAuth');
        }
      } else {
        updateAdCreationStep('selectCampaignOption');
      }
    } else {
      throw new Error(data.message);
    }
  } catch (error) {
    console.error('Error starting ad creation:', error);
    updateAdCreationStep('error');
  }
};

const handleGoogleAdsLogin = async () => {
  try {
    const response = await fetch(`${API_URL}/initiate-google-ads-oauth`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (response.ok) {
      const { authUrl } = await response.json();
      const newWindow = window.open(authUrl, '_blank', 'width=600,height=600');

      if (newWindow) {
        window.addEventListener('message', async (event) => {
          if (event.data.type === 'OAUTH_CALLBACK') {
            newWindow.close();
            if (event.data.success) {
              const { sessionId, tokens } = event.data;
              await exchangeGoogleAdsCode( sessionId, tokens);
            } else {
              throw new Error(event.data.error || 'Failed to authenticate with Google Ads');
            }
          }
        });
      }
    } else {
      throw new Error('Failed to initiate Google Ads OAuth');
    }
  } catch (error) {
    console.error('Error in Google Ads login:', error);
    updateAdCreationStep('error');
  }
};

const exchangeGoogleAdsCode = async ( sessionId: string, tokens: string) => {
  try {
    const response = await fetch(`${API_URL}/exchangeGoogleAdsCode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ businessName: analysisResults?.businessName, sessionId, tokens })
    });

    if (response.ok) {
      const data = await response.json();
      if (data.success) {
        setShowCustomerIdModal(true);
      } else {
        throw new Error(data.message);
      }
    } else {
      throw new Error('Failed to exchange code for tokens');
    }
  } catch (error) {
    console.error('Error exchanging code for tokens:', error);
    updateAdCreationStep('error');
  }
};

const updateCustomerId = async (customerId: string) => {
  try {
    const response = await fetch(`${API_URL}/updateCustomerId`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ businessName: analysisResults?.businessName, customerId })
    });

    if (response.ok) {
      const data = await response.json();
      if (data.success) {
        setAlertMessage(''); 
        updateAdCreationStep('selectCampaignOption');
        localStorage.setItem('step', 'selectCampaignOption');
      } else {
        throw new Error(data.message);
      }
    } else {
      throw new Error('Failed to update customer ID');
    }
  } catch (error) {
    console.error('Error updating customer ID:', error);
    updateAdCreationStep('error');
  } finally {
    setShowCustomerIdModal(false);
  }
};

useEffect(() => {
  if (sidebarContent === 'authenticated') {
    updateAdCreationStep('selectCampaignOption');
  }
}, [sidebarContent]);

useEffect(() => {
  if (adCreationStep === 'displaySelectedAds') {
    fetchRandomGoogleDoodle();
  }
}, [adCreationStep]);

const fetchRandomGoogleDoodle = async () => {
  try {
    const response = await fetch(`${API_URL}/random-doodle`);
    const data = await response.json();
    setGoogleDoodleUrl(data.url);
  } catch (error) {
    console.error('Error fetching Google Doodle:', error);
  }
};

const renderSidebarContent = () => {  
  if (sidebarContent === 'authenticated') {
    return renderAdCreationStep();
  } else if (sidebarContent === 'loggedIn') {
    return renderAnalysisResults();
  }  else if (sidebarContent === 'test') {
    return user || analysisResults ? renderAnalysisResults() : renderBotContent();
  } else if (sidebarContent === 'info') {
    return <InfoContent />;
  } else if (adCreationStep === 'selectCampaignOption') {
    return renderAnalysisResults()
  } else if (sidebarContent === 'onboarding') {
    return (
      <div className="sidebar-content">
        <h2>{onboardingMessage}</h2>
        <button onClick={startSession} disabled={isLoading}>Start Session</button>
      </div>
    );
  } else if (sidebarContent === 'success') {
    return (
      <div className="discord-embed">
        <div className="embed-title">Success!</div>
        <div className="embed-content">
          <p>Google Ads have been created successfully!</p>
          <p>You have been logged out. Please log in again to continue.</p>
        </div>
      </div>
    );
  } else {
    return null;
  }
};

const fetchExistingCampaigns = async () => {
  setIsLoadingCampaigns(true);
  const storedAnalysis = localStorage.getItem('Analysis');
  if (!storedAnalysis) {
    console.error('No analysis data found in localStorage');
    return;
  }
  const parsedAnalysis = JSON.parse(storedAnalysis);

  try {
    const response = await fetch(`${API_URL}/getCampaigns`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ businessName: parsedAnalysis?.businessName }),
    });
    const data = await response.json();
    if (data.success && data.campaigns) {
      // Get the first (and likely only) key in the campaigns object
      const accountId = Object.keys(data.campaigns)[0];
      const campaignsList = data.campaigns[accountId].Campaigns;
      setCampaigns(campaignsList);
    } else {
      throw new Error(data.message || 'Failed to fetch campaigns');
    }
  } catch (error) {
    console.error('Error fetching campaigns:', error);
    // Handle error (e.g., show error message to user)
  } finally {
    setIsLoadingCampaigns(false);
  }
};

const fetchBusinessInfo = async (user: User) => {
  try {
    const idToken = await user.getIdToken();
    const response = await fetch(`${API_URL}/auth/google`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ idToken }),
    });
    
    if (response.ok) {
      const data = await response.json();
      if (data.businessName) {
        updateBusinessName(data.businessName);
        const descriptionResponse = await fetch(`${API_URL}/getBusinessDescription`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ businessName: data.businessName }),
        });
        if (descriptionResponse.ok) {
          const descriptionData = await descriptionResponse.json();
          if (descriptionData.businessDescription){
            setBusinessDescription(descriptionData.businessDescription);
            localStorage.setItem('businessDescription', descriptionData.businessDescription);
          }
        }
        await fetchAnalysisResults(data.businessName);
    }
  }
} catch (error) {
    console.error('Error fetching business info:', error);
  }
};

useEffect(() => {
  if (user) {
    setShowLoginButton(false);
    if (!businessName) { 
      fetchBusinessInfo(user);
    }
  } else if (!loading) {
    setShowLoginButton(true);
    updateBusinessName('');
    setBusinessDescription('');
  }
}, [user, loading, businessName]);

useEffect(() => {
  const isLogged = localStorage.getItem('userLoggedIn');
  setUserLoggedIn(isLogged ? 'true' : 'false');
}, [userLoggedIn]);

const handleCampaignSelect = async (campaign: { id: string, name: string }) => {
  setSelectedCampaign(campaign);
  localStorage.setItem('selectedCampaign', JSON.stringify(campaign));
  setIsCreatingAds(true);
  try {
    await createAds(1);
  } finally {
    setIsCreatingAds(false);
  }
};


const handleAdSelectorResponse = (data: { 
  selected_ads: Array<{ 
    headlines: string[],
    descriptions: string[],
    keywords?: string[],
    additional_headlines?: string[],
    additional_descriptions?: string[]
  }>, 
  website: string 
}) => {
  const adsWithWebsite = data.selected_ads.map(ad => ({
    ...ad,
    website: data.website,
    keywords: ad.keywords || [], // Ensure keywords are included
    additional_headlines: ad.additional_headlines || [],
    additional_descriptions: ad.additional_descriptions || [],
    currentHeadlineIndex: 0,
    currentDescriptionIndex: 0
  }));
  setSelectedAds(adsWithWebsite);
  updateAdCreationStep('displaySelectedAds');
};

const createAds = async (numberOfAds: number) => {
  try {
    const storedAnalysis = localStorage.getItem('Analysis');
    if (!storedAnalysis) {
      console.error('No analysis data found in localStorage');
      return;
    }
    const parsedAnalysis = JSON.parse(storedAnalysis);
    const response = await fetch(`${API_URL}/proxy/ad-selector`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        business_name: parsedAnalysis?.businessName,
        number_of_ads: numberOfAds
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to create ads');
    }

    const result = await response.json();
    handleAdSelectorResponse(result);
    updateAdCreationStep('displaySelectedAds');
  } catch (error) {
    console.error('Error creating ads:', error);
    updateAdCreationStep('error');
  } finally {
    setIsCreatingAds(false);
  }
};

useEffect(() => {
  if (analysisResults) {
    setResearchPaths(analysisResults.marketingData.list_of_paths_taken);
    setEditedPersonas(analysisResults.marketingData.user_personas);
    updateBusinessName(analysisResults.businessName);
    setAnalysisStarted(false);
    localStorage.setItem('Analysis', JSON.stringify(analysisResults));
    setAnalysisResults(analysisResults);
  }
}, [analysisResults]);

const renderResearchPaths = () => {
  if (!analysisResults) return null;

  const handleDeletePath = async (index: number) => {
    if (window.confirm("Are you sure you want to delete this research path?")) {
      try {
        const response = await fetch(`${API_URL}/deleteResearchPath`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            businessName: analysisResults.businessName,
            pathIndex: index,
          }),
        });

        if (!response.ok) {
          throw new Error('Failed to delete research path');
        }

        const data = await response.json();
        if (data.success) {
          setAnalysisResults(prevResults => ({
            ...prevResults!,
            marketingData: {
              ...prevResults!.marketingData,
              list_of_paths_taken: data.updatedPaths,
            },
          }));
        } else {
          throw new Error(data.message || 'Failed to delete research path');
        }
      } catch (error) {
        console.error('Error deleting research path:', error);
        // You might want to show an error message to the user here
      }
    }
  };

const handleAddPath = async () => {
    if (newPath.trim() === '') return;

    try {
      const response = await fetch(`${API_URL}/addResearchPath`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          businessName: analysisResults.businessName,
          newPath: newPath.trim(),
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to add research path');
      }

      const data = await response.json();
      if (data.success) {
        setAnalysisResults(prevResults => ({
          ...prevResults!,
          marketingData: {
            ...prevResults!.marketingData,
            list_of_paths_taken: data.updatedPaths,
          },
        }));
        setNewPath('');
      } else {
        throw new Error(data.message || 'Failed to add research path');
      }
    } catch (error) {
      console.error('Error adding research path:', error);
      // You might want to show an error message to the user here
    }
  };

  return (
    <div className="discord-embed">
      <div className="embed-title">Research Paths</div>
      <div className="embed-content">
        <p className="help-text">
          Add or delete paths our AI Agent uses to research keywords that users could use that could show strong intent to interact with your product or service.
        </p>
        <div className="scrollable-content">
          {researchPaths.map((path, index) => (
            <div key={index} className="research-path-item">
              <span>{path}</span>
              <button 
                onClick={() => handleDeletePath(index)} 
                className="delete-path-button"
                aria-label="Delete path"
              >
                (X)
              </button>
            </div>
          ))}
        </div>
        <div className="add-path-container">
          <input
            type="text"
            value={newPath}
            onChange={(e) => setNewPath(e.target.value)}
            placeholder="Enter new research path"
            className="add-path-input"
          />
          <button 
            onClick={handleAddPath} 
            className="add-path-button"
            disabled={!newPath.trim()}
          >
            Add Path
          </button>
        </div>
      </div>
    </div>
  );
};


  const chatContainerRef = useRef<HTMLDivElement>(null);
  
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const thinkingSteps = [
    "Thinking",
    `Researching ${businessName}`,
    "Learning about your users",
    "Grouping users into user personas",
    `Generating Research Paths for ${businessName}`,
    "Thinking"
  ];

  const FAQItem: React.FC<{ question: string; content: string }> = ({ question, content }) => {
    return (
      <button className="faq-item" onClick={() => setFaqContent(content)}>
        {question}
      </button>
    );
  };

  const scrollToBottom = () => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const parseMessage = (content: string) => {
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    return content.replace(linkRegex, (_match, text, url) => {
      return `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    });
  };
  
  const toggleSidebar = (content: 'test' | 'info' | 'onboarding' | 'authenticated' | 'loggedIn' | null) => {
    let newIsOpen = true
    if (content === "test" || content === "info") {
      newIsOpen = !isSidebarOpen;
    }
    setSidebarContent(content);
    setIsSidebarOpen(newIsOpen);

    setTimeout(() => {
      console.log('Updated sidebarContent:', content);
      console.log('Updated onboardingMessage:', onboardingMessage);
      }, 0);
    localStorage.setItem('currSideBarState', JSON.stringify({ 
      content: content, 
      isOpen: newIsOpen 
    }));
  
    if (sessionId) {
      fetch(`${API_URL}/updateSidebarState`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId,
          sidebarContent: content,
          isSidebarOpen: newIsOpen
        }),
      }).catch(error => console.error('Error updating sidebar state:', error));
    }
  };
  
  const API_URL = import.meta.env.MODE === 'production' 
  ? import.meta.env.VITE_API_URL_PROD 
  : import.meta.env.VITE_API_URL_DEV;

  const startSession = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`${API_URL}/startSession`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      const data = await response.json();
      if (data.success) {
        setSessionId(data.sessionId);
        const initialMessages = data.initialMessages.map((msg: string) => ({ 
          content: parseMessage(msg), 
          isBot: true 
        }));
        setMessages(initialMessages);
        localStorage.setItem('currSessionId', data.sessionId);
        localStorage.setItem('chatMessages', JSON.stringify(initialMessages));
        
        // Set sidebar state from session data
        if (data.sessionData) {
          setSidebarContent(data.sessionData.sidebarContent);
          setIsSidebarOpen(data.sessionData.isSidebarOpen); 
          // Store the sidebar state in localStorage
          localStorage.setItem('currSideBarState', JSON.stringify({
            content: data.sessionData.sidebarContent,
            isOpen: data.sessionData.isSidebarOpen
          }));
        }
      } else {
        throw new Error(data.message);
      }
    } catch (error) {
      console.error('Failed to start session:', error);
      setMessages([{ content: 'Failed to start session. Please try again.', isBot: true }]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (analysisStarted && remainingTime > 0) {
      timer = setInterval(() => {
        setRemainingTime((prevTime) => prevTime - 1);
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [analysisStarted, remainingTime]);

  useEffect(() => {
    let stepInterval: NodeJS.Timeout;
    if (analysisStarted) {
      let currentStepIndex = 0;
      const stepDuration = 4000; 
      
      setCurrentThinkingStep(thinkingSteps[currentStepIndex]);
      stepInterval = setInterval(() => {
        currentStepIndex = (currentStepIndex + 1) % thinkingSteps.length;
        setCurrentThinkingStep(thinkingSteps[currentStepIndex]);
      }, stepDuration);
    }
    return () => clearInterval(stepInterval);
  }, [analysisStarted, businessName, thinkingSteps]);

  const checkAnalysisStatus = async () => {
    try {
      const response = await fetch(`${API_URL}/checkAnalysisStatus`);
      const data = await response.json();

      switch (data.type) {
        case 'analysisComplete':
          setAnalysisResults(data);
          setAnalysisStarted(false);
          break;
        case 'analysisInProgress':
          setCurrentThinkingStep(data.message);
          setAnalysisStarted(true);
          setTimeout(checkAnalysisStatus, 5000);
          break;
        case 'noActiveAnalysis':
          setAnalysisStarted(false);
          break;
        case 'error':
          console.error('Error:', data.message);
          setAnalysisStarted(false);
          break;
      }
    } catch (error) {
      console.error('Error checking analysis status:', error);
      setAnalysisStarted(false);
    }
  };

  useEffect(() => {
    if (analysisStarted) {
      checkAnalysisStatus();
    }
  }, [analysisStarted]);
  
  const sendMessage = async (message: string) => {
    if (!sessionId) return;
    setIsLoading(true);
    try {
      const response = await fetch(`${API_URL}/sendMessage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sessionId, message }),
        credentials: 'include',
      });
      const data = await response.json();
      if (data.success) {
        const newMessages = data.messages.map((msg: { content: string, isBot: boolean }) => ({
          content: parseMessage(msg.content),
          isBot: msg.isBot,
        }));
        setMessages((prevMessages) => [...prevMessages, ...newMessages]);
  
        if (data.sessionData) {
          if (data.sessionData.businessInfo?.name) {
            updateBusinessName(data.sessionData.businessInfo.name);
          }
        }

        if (data.analysisResults) {
          setAnalysisResults(data.analysisResults);
          setAnalysisStarted(false);
        } else if (newMessages.some((msg: { content: string, isBot: boolean }) => msg.content.includes("Our Company Researcher agent will now start analyzing"))) {
          setAnalysisResults(null);
          setAnalysisStarted(true);
          setShowYesNo(false);
          setMessages([]);
          setRemainingTime(240);
        } else if (newMessages.some((msg: { content: string, isBot: boolean }) => msg.content.includes("Do you consent to this information being sent to you via email"))) {
          setShowYesNo(true);
        } else {
          setShowYesNo(false);
        }
      } else if (data.showLogin) {
        setAlertMessage(data.message);
        localStorage.setItem('alertMessage', data.message);
        setShowLoginButton(true);
        localStorage.setItem('showLoginButton', 'true');
        setMessages((prevMessages) => [...prevMessages, { content: data.message, isBot: true }]);
        setIsInputDisabled(true);
      } else {
        throw new Error(data.message);
      }
    } catch (error) {
      console.error('Failed to send message:', error);
      setMessages((prevMessages) => [...prevMessages, { content: 'Failed to send message. Please try again.', isBot: true }]);
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleLoginClick = async () => {
    try {
      // Initialize Google Auth Provider
      const provider = new GoogleAuthProvider();
      // Attempt to sign in with popup
      const result = await signInWithPopup(auth, provider);
      const user = result.user;
      // Get the ID token from the user
      const idToken = await user.getIdToken();
      
      // Send the ID token to our backend for verification
      const response = await fetch(`${API_URL}/auth/google`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ idToken }),
      });

      if (response.ok) {
        const data = await response.json();
        // Open the sidebar and display the onboarding message
        if (data.requiresOnboarding) {
          setOnboardingMessage(data.message);  
          // Use setTimeout to ensure onboardingMessage is set before opening sidebar
          await new Promise(resolve => setTimeout(resolve, 0));
          toggleSidebar('onboarding');
          } else if (data.success){
          setShowLoginButton(false);
          localStorage.removeItem('showLoginButton');
          localStorage.removeItem('alertMessage');
          setAlertMessage('');
          // Store user data in local storage
          localStorage.setItem('user', JSON.stringify({
            uid: user.uid,
            email: user.email,
            displayName: user.displayName,
            businessName: data.businessName,
            businessDescription: data.businessDescription
          }));

          localStorage.setItem('userLoggedIn', 'true')
          setUserLoggedIn('true')

          if (data.businessName) {
            updateBusinessName(data.businessName);
            setBusinessDescription(data.businessDescription);
            await fetchAnalysisResults(data.businessName); 
          }
          toggleSidebar('loggedIn');
        }
      } else {
        throw new Error('Failed to authenticate with the server');
      }
    } catch (error) {
      console.error('Error during Google Sign-In:', error);
      setAlertMessage('Failed to sign in. Please try again.');
    }
  };

  useEffect(() => {
  if (onboardingMessage) {
    toggleSidebar('onboarding');
  }
}, [onboardingMessage]);

  const fetchAnalysisResults = async (businessName: string) => {
    try {
      const url = `${API_URL}/api/analysisResults`;
      const body = JSON.stringify({ businessName });  
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: body,
      });  
      if (!response.ok) {
        const errorText = await response.text();
        console.error('Error response:', errorText);
        throw new Error(`Failed to fetch analysis results: ${response.status} ${errorText}`);
      }
  
      const data = await response.json();  
      const formattedData: AnalysisResult = {
        businessName: data.businessName,
        marketingData: {
          business: data.marketingData.business,
          date_written: data.marketingData.date_written,
          list_of_ad_text: data.marketingData.list_of_ad_text,
          list_of_keywords: data.marketingData.list_of_keywords, 
          list_of_paths_taken: data.marketingData.list_of_paths_taken,
          user_personas: data.marketingData.user_personas,
          last_update: data.marketingData.last_update || new Date().toISOString(),
        },
      };
        setAnalysisResults(formattedData);
      localStorage.setItem('Analysis', JSON.stringify(formattedData))
      setAnalysisInProgress(false);
      setAnalysisResultsLoaded(true);
    } catch (error) {
      console.error('Error fetching analysis results:', error);
      setAnalysisInProgress(false);
      setAnalysisResultsLoaded(false);
      }
  };
  
  const handleDismissClick = () => {
    setAlertMessage('');
    setShowLoginButton(false);
    localStorage.setItem('showLoginButton', 'false');
    localStorage.removeItem('showLoginButton');
  };

  const endSession = async () => {
    if (!sessionId) return;
    setIsLoading(true);
    try {
      const response = await fetch(`${API_URL}/endSession`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sessionId }),
      });
      const data = await response.json();
      if (data.success) {
        setSessionId(null);
        setMessages([]);
        setAnalysisStarted(false);
        setRemainingTime(240);
        updateBusinessName('');
        setShowLoginButton(false);
        setAlertMessage('');

        // Clear sidebar state
        setSidebarContent(null);
        setIsSidebarOpen(false);

        // Clear localStorage
        localStorage.clear();
      } else {
        throw new Error(data.message);

      }
    } catch (error) {
      console.error('Failed to end session:', error);
      setMessages((prevMessages) => [...prevMessages, { content: 'Failed to end session. Please try again.', isBot: true }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleYesNo = async (response: string) => {
    await sendMessage(response);
    setShowYesNo(false);
  };

  const renderBusinessName = () => {
    const storedAnalysis = localStorage.getItem('Analysis');
    const currentAnalysis = analysisResults || (storedAnalysis ? JSON.parse(storedAnalysis) : null);
    
    return (
      <div className="discord-embed">
        <div className="embed-title">Business Name</div>
        <div className="embed-content">
          <div className="embed-text">{currentAnalysis?.businessName}</div>
        </div>
      </div>
    );
  };

  const renderAnalysisResults = () => {
    const storedAnalysis = localStorage.getItem('Analysis');
    const currentAnalysis = analysisResults || (storedAnalysis ? JSON.parse(storedAnalysis) : null);
    
    if (!currentAnalysis) return null;

    const sections = [
      { key: 'businessName', label: 'Business Name' },
      { key: 'ad_variations', label: 'Ad Text' },
      { key: 'keywords', label: 'Keywords' },
      { key: 'list_of_paths_taken', label: 'Research Paths' },
      { key: 'user_personas', label: 'User Personas' },
    ];

    const finalizedHeadlines = currentAnalysis.marketingData.list_of_ad_text.headlines.filter((h: AdHeadline | string) => 
      typeof h === 'object' && 'finalized' in h && h.finalized
    ).length;
    const finalizedDescriptions = currentAnalysis.marketingData.list_of_ad_text.descriptions.filter((d: AdDescription | string) => 
      typeof d === 'object' && 'finalized' in d && d.finalized
    ).length;
    const canProceed = finalizedHeadlines >= 3 && finalizedDescriptions >= 2;

    const handleCreateAdClick = () => {
      if (canProceed) {
        startAdCreation();
      } else {
        alert(`Please finalize at least 3 headlines and 2 descriptions before creating an ad.
        
      Current status:
      Finalized Headlines: ${finalizedHeadlines}/3
      Finalized Descriptions: ${finalizedDescriptions}/2`);
      }
    };

    // Update the handleGenerateNewOutput function
    const handleGenerateNewOutput = async () => {
      if (window.confirm("For AdAlchemyAI to generate more personalized output, make sure you select keywords and edit and finalize ad text to help AI learn about your preferences")) {
        setIsGeneratingOutput(true); 
        try {
          const storedAnalysis = localStorage.getItem('Analysis');
          if (!storedAnalysis) {
            throw new Error('No analysis data found in localStorage');
          }
          const parsedAnalysis = JSON.parse(storedAnalysis);
          
          const response = await fetch(`${API_URL}/generateNewOutput`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              businessName: parsedAnalysis.businessName
            })
          });

          if (!response.ok) {
            throw new Error('Failed to generate new output');
          }

          const result = await response.json();
          
          // Update Analysis in localStorage and state with new data
          const updatedAnalysis = {
            ...parsedAnalysis,
            marketingData: {
              ...parsedAnalysis.marketingData,
              // Merge existing keywords with new ones, preserving "new" labels
              list_of_keywords: [
                // Remove "new" flag from existing keywords
                ...parsedAnalysis.marketingData.list_of_keywords.map((k: Keyword) => ({
                  ...k,
                  new: undefined
                })),
                // Add new keywords with "new" flag
                ...result.data.list_of_keywords.map((k: Keyword) => ({
                  ...k,
                  new: true
                }))
              ],
              // Merge existing ad text with new ones
              list_of_ad_text: {
                headlines: [
                  // Remove "new" flag from existing headlines
                  ...parsedAnalysis.marketingData.list_of_ad_text.headlines.map((h: AdHeadline) => 
                    typeof h === 'string' ? h : { ...h, new: undefined }
                  ),
                  // Add new headlines with "new" flag
                  ...result.data.list_of_ad_text.headlines.map((h: AdHeadline) => ({
                    text: typeof h === 'string' ? h : h.text,
                    new: true
                  }))
                ],
                descriptions: [
                  // Remove "new" flag from existing descriptions
                  ...parsedAnalysis.marketingData.list_of_ad_text.descriptions.map((d: AdDescription)=> 
                    typeof d === 'string' ? d : { ...d, new: undefined }
                  ),
                  // Add new descriptions with "new" flag
                  ...result.data.list_of_ad_text.descriptions.map((d: AdDescription) => ({
                    text: typeof d === 'string' ? d : d.text,
                    new: true
                  }))
                ]
              }
            }
          };
          
          localStorage.setItem('Analysis', JSON.stringify(updatedAnalysis));
          setAnalysisResults(updatedAnalysis);
          
        } catch (error) {
          console.error('Error generating new output:', error);
          alert('Failed to generate new output. Please try again.');
        } finally {
          setIsGeneratingOutput(false); 
        }
      }
    };

    return (
      <div className="analysis-results">
        <h2>Keyword Research Output</h2>
        {sections.map((section) => (
          <div key={section.key} className="result-section">
            <div 
              className="faq-item" 
              onClick={() => setSelectedSection(selectedSection === section.key ? null : section.key)}
            >
              {section.label} {selectedSection === section.key ? '▲' : '▼'}
            </div>
            {selectedSection === section.key && renderSectionContent(section.key)}
          </div>
        ))}
        <div className="action-buttons">
          <button 
            className="create-ad-button" 
            onClick={handleCreateAdClick}
            disabled={isAuthenticating || !canProceed || isGeneratingOutput}
          >
            {isAuthenticating 
              ? `Authenticating (${authenticationTimer}s)` 
              : canProceed ? "Create Ad" : "Finalize more ads"
            }
          </button>
          <button 
            className="create-ad-button"
            onClick={handleGenerateNewOutput}
            disabled={isGeneratingOutput}
          >
            {isGeneratingOutput ? (
              <div className="spinner-container">
                <SyncLoader color="#ffffff" size={15} />
              </div>
            ) : "Generate New Output"}
          </button>
        </div>
        {!canProceed && (
          <p className="warning-text">
            Please finalize at least 3 headlines and 2 descriptions before creating an ad.
            <br />
            Current status: {finalizedHeadlines}/3 headlines, {finalizedDescriptions}/2 descriptions finalized.
          </p>
        )}
      </div>
    );
  };

  const authenticate = async () => {
    const storedAnalysis = localStorage.getItem('Analysis')!;
    const parsedAnalysis = JSON.parse(storedAnalysis);

    try {
      const response = await fetch(`${API_URL}/authenticate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ businessName: parsedAnalysis?.businessName }),
      });
      const data = await response.json();
      if (data.success) {
        if (data.authUrl) {
          // Redirect the user to the Google OAuth URL
          window.location.href = data.authUrl;
        } else {
          updateAdCreationStep('selectCampaignOption');
          setSidebarContent('authenticated');
        }
      } else {
        throw new Error(data.message);
      }
    } catch (error) {
      console.error('Error during authentication:', error);
      updateAdCreationStep('error');
    } 
  };

  const renderSectionContent = (key: string) => {
    const storedAnalysis = localStorage.getItem('Analysis');
    const currentAnalysis = analysisResults || (storedAnalysis ? JSON.parse(storedAnalysis) : null);
    
    if (!currentAnalysis) return null;

    switch (key) {
      case 'businessName':
        return renderBusinessName();
        case 'ad_variations':
        return renderAdVariations();
      case 'keywords':
        return renderKeywords();
      case 'list_of_paths_taken':
        return renderResearchPaths();
      case 'user_personas':
        return renderUserPersonas();
      default:
        return null;
    }
  };

  const HEADLINE_CHAR_LIMIT = 30;
  const DESCRIPTION_CHAR_LIMIT = 90;


  const renderAdVariations = () => {
    const storedAnalysis = localStorage.getItem('Analysis');
    const currentAnalysis = analysisResults || (storedAnalysis ? JSON.parse(storedAnalysis) : null);

    if (!currentAnalysis) return null;
  
      const adVariations = currentAnalysis.marketingData.list_of_ad_text;
      
      const hasChanges = editedHeadlines.some((headline, index) => 
        headline !== undefined && headline !== (adVariations.headlines[index].text || adVariations.headlines[index])
      ) || editedDescriptions.some((description, index) => 
        description !== undefined && description !== (adVariations.descriptions[index].text || adVariations.descriptions[index])
      );
    
      const currentVariation = {
        headlines: adVariations.headlines,
        descriptions: adVariations.descriptions
      };
      const isFinalized = (currentVariation as unknown as { finalized: boolean }).finalized;

      const isAnyLimitExceeded = editedHeadlines.some(headline => headline && headline.length > HEADLINE_CHAR_LIMIT) ||
      editedDescriptions.some(description => description && description.length > DESCRIPTION_CHAR_LIMIT);
  
      const handleHeadlineChange = (index: number, value: string) => {
      const newHeadlines = [...editedHeadlines];
      newHeadlines[index] = value;
      setEditedHeadlines(newHeadlines);
    };
  
    const handleDescriptionChange = (index: number, value: string) => {
      const newDescriptions = [...editedDescriptions];
      newDescriptions[index] = value;
      setEditedDescriptions(newDescriptions);
    };
  
    const handleSubmit = async () => {
      const business = analysisResults?.businessName

      const changedHeadlines = editedHeadlines.map((headline, index) => 
        headline !== undefined ? { index, value: headline } : null
      ).filter(Boolean);
    
      const changedDescriptions = editedDescriptions.map((description, index) => 
        description !== undefined ? { index, value: description } : null
      ).filter(Boolean);

      if (changedHeadlines.length === 0 && changedDescriptions.length === 0) return;

        
      try {
        const response = await fetch(`${API_URL}/submitAdVariation`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            business,
            variationIndex: currentAdVariation,
            changedHeadlines,
            changedDescriptions,
          }),
        });
    
        if (!response.ok) {
          throw new Error('Failed to submit ad variation');
        }
    
        const data = await response.json();
    
        if (data.success) {
          // Update local state
          setAnalysisResults(prevResults => {
            if (!prevResults) return null;
    
            const newListOfAdText = { ...prevResults.marketingData.list_of_ad_text };
    
            changedHeadlines.forEach((change) => {
              const {index, value} = change as {index: number, value: string};
              newListOfAdText.headlines[index] = value;
            });
    
            changedDescriptions.forEach((change) => {
              const {index, value} = change as {index: number, value: string};
              newListOfAdText.descriptions[index] = value;
            });
    
            return {
              ...prevResults,
              marketingData: {
                ...prevResults.marketingData,
                list_of_ad_text: newListOfAdText
              }
            };
          });
    
          // Reset edited fields
          setEditedHeadlines([]);
          setEditedDescriptions([]);
    
        } else {
          throw new Error(data.message || 'Failed to submit ad variation');
        }
      } catch (error) {
        console.error('Error submitting ad variation:', error);
        // You might want to show an error message to the user here
      }
    };

    const handleDelete = async (type: 'headline' | 'description', index: number) => {
      const business = analysisResults?.businessName
      if (window.confirm("Are you sure you want to delete this ad variation?")) {
        try {
          const response = await fetch(`${API_URL}/deleteAdVariation`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ 
              business,
              type,
              index
            }),
          });
          const data = await response.json();
          if (data.success) {
            // Remove the variation from the local state
            setAnalysisResults(prevResults => {
              if (!prevResults) return null;
              const newAdVariations = { ...prevResults.marketingData.list_of_ad_text };
              newAdVariations[`${type}s`] = newAdVariations[`${type}s`].filter((_, i) => i !== index);
              return {
                ...prevResults,
                marketingData: {
                  ...prevResults.marketingData,
                  list_of_ad_text: newAdVariations
                }
              };
            });

          // Update editedHeadlines or editedDescriptions
          if (type === 'headline') {
            setEditedHeadlines(prev => prev.filter((_, i) => i !== index));
          } else {
            setEditedDescriptions(prev => prev.filter((_, i) => i !== index));
          }

          // Update localStorage
          const storedAnalysis = JSON.parse(localStorage.getItem('Analysis') || '{}');
          if (storedAnalysis.marketingData && storedAnalysis.marketingData.list_of_ad_text) {
            storedAnalysis.marketingData.list_of_ad_text[`${type}s`] = 
              storedAnalysis.marketingData.list_of_ad_text[`${type}s`].filter((_: unknown, i: number) => i !== index);
            localStorage.setItem('Analysis', JSON.stringify(storedAnalysis));
          }
  
          } else {
            throw new Error(data.message);
          }
        } catch (error) {
          console.error('Error deleting ad variation:', error);
          // Handle error (e.g., show error message to user)
        }
      }
    };

    const handleFinalize = async (type: 'headline' | 'description', index: number) => {
      try {
        const response = await fetch(`${API_URL}/finalizeAdVariation`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            businessName: analysisResults?.businessName,
            type,
            index
          }),
        });
    
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
    
        const data = await response.json();
    
        if (data.success) {
          // Only update the local state if the server request was successful
          setAnalysisResults(prevResults => {
            if (!prevResults) return null;
            const newAdVariations = { ...prevResults.marketingData.list_of_ad_text };
            const itemArray = newAdVariations[`${type}s`];
            itemArray[index] = typeof itemArray[index] === 'string' 
              ? itemArray[index] 
              : (itemArray[index] as { text: string }).text;
            return {
              ...prevResults,
              marketingData: {
                ...prevResults.marketingData,
                list_of_ad_text: newAdVariations
              }
            };
          });
    
          // Update localStorage
          const storedAnalysis = JSON.parse(localStorage.getItem('Analysis') || '{}');
          const itemArray = storedAnalysis.marketingData.list_of_ad_text[`${type}s`];
          itemArray[index] = { text: itemArray[index].text || itemArray[index], finalized: true };
          localStorage.setItem('Analysis', JSON.stringify(storedAnalysis));    
        } else {
          throw new Error(data.message || 'Failed to finalize ad variation');
        }
      } catch (error) {
        console.error(`Error finalizing ${type}:`, error);
        // You might want to show an error message to the user here
        // For example:
        // setErrorMessage(`Failed to finalize ${type}. Please try again.`);
      }
    };
  
    return (
      <div className="discord-embed">
        <div className="embed-title">
          Ad Variations 
          {isFinalized && <span className="finalized-tag">(Finalized - This is a variation that will be used to run ads)</span>}
        </div>
        <div className="embed-content">
          <div className="scrollable-content">
            <h4>Headlines:</h4>
            {currentVariation.headlines.map((headline: string | AdHeadline, index: number) => {
              const headlineText = typeof headline === 'object' ? headline.text : headline;
              const currentLength = (editedHeadlines[index] || headlineText).length;
              const isExceeded = currentLength > HEADLINE_CHAR_LIMIT;
              const isNew = typeof headline === 'object' && headline.new;

              return (
                <div key={`headline-${index}`} className="ad-variation-item">
                  <button 
                    onClick={() => handleFinalize('headline', index)} 
                    className="finalize-button"
                    disabled={isExceeded}
                  >✓</button>
                  <div className="input-wrapper">
                    <input
                      type="text"
                      value={editedHeadlines[index] || headlineText}
                      onChange={(e) => handleHeadlineChange(index, e.target.value)}
                      className={`embed-input ${isExceeded ? 'exceed-limit' : ''}`}
                    />
                    {isNew && <span className="new-label"> - NEW</span>}
                  </div>
                  <div className="ad-variation-controls">
                    {(typeof headline === 'object' && 'finalized' in headline) && 
                      (headline as AdHeadline).finalized && 
                      <span className="finalized-tag">Finalized</span>
                    }
                    <button onClick={() => handleDelete('headline', index)} className="delete-button">✗</button>
                  </div>
                  {isExceeded && 
                    <div className="char-limit-warning">
                      Exceeded by {currentLength - HEADLINE_CHAR_LIMIT} char(s)
                    </div>
                  }
                </div>
              );
            })}
            <h4>Descriptions:</h4>
            {currentVariation.descriptions.map((description: string | AdDescription, index: number) => {
              const descriptionText = typeof description === 'object' ? description.text : description;
              const currentLength = (editedDescriptions[index] || descriptionText).length;
              const isExceeded = currentLength > DESCRIPTION_CHAR_LIMIT;
              const isNew = typeof description === 'object' && description.new;

              return (
                <div key={`description-${index}`} className="ad-variation-item">
                  <button 
                    onClick={() => handleFinalize('description', index)} 
                    className="finalize-button"
                    disabled={isExceeded}
                  >✓</button>
                  <div className="input-wrapper">
                    <textarea
                      value={editedDescriptions[index] || descriptionText}
                      onChange={(e) => handleDescriptionChange(index, e.target.value)}
                      className={`embed-textarea ${isExceeded ? 'exceed-limit' : ''}`}
                    />
                    {isNew && <span className="new-label"> - NEW</span>}
                  </div>
                  <div className="ad-variation-controls">
                    {(typeof description === 'object' && 'finalized' in description) && 
                      (description as AdDescription).finalized && 
                      <span className="finalized-tag">Finalized</span>
                    }
                    <button onClick={() => handleDelete('description', index)} className="delete-button">✗</button>
                  </div>
                  {isExceeded && 
                    <div className="char-limit-warning">
                        Exceeded by {currentLength - HEADLINE_CHAR_LIMIT} char(s)
                    </div>
                  }
                </div>
              );
            })}
          </div>
          <button 
            onClick={handleSubmit} 
            className="embed-button"
            disabled={!hasChanges || isAnyLimitExceeded}
          >Submit Changes
          </button>
        </div>
      </div>
    );
  };

  const renderKeywords = () => {
    if (!analysisResults) return null;    
    const toggleKeyword = (keyword: Keyword) => {
      setSelectedKeywords(prevSelected => {
        const newSelected = new Set(prevSelected);
        const keywordString = JSON.stringify(keyword);
        if (newSelected.has(keywordString)) {
          newSelected.delete(keywordString);
        } else {
          newSelected.add(keywordString);
        }
        return newSelected;
      });
    };

    const getCompetitivenessColor = (competitiveness: string) => {
    switch (competitiveness.toLowerCase()) {
      case 'low':
        return 'green';
      case 'medium':
        return 'orange';
      case 'high':
        return 'red';
      default:
        return 'gray';
    }
  };

    const handleSubmitKeywords = async () => {
      try {
        const response = await fetch(`${API_URL}/submitKeywords`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            businessName: analysisResults.businessName,
            selectedKeywords: Array.from(selectedKeywords),
          }),
        });
        if (!response.ok) {
          throw new Error('Failed to submit keywords');
        }
        const data = await response.json();
        if (data.success) {
          setAnalysisResults(prevResults => {
            if (!prevResults) return null;
    
            return {
              ...prevResults,
              marketingData: {
                ...prevResults.marketingData,
                list_of_keywords: Array.from(selectedKeywords),
              },
            };
          });
    
          // Reset selected keywords
          setSelectedKeywords(new Set(selectedKeywords));    
        } else {
          throw new Error(data.message || 'Failed to submit keywords');
        }
      } catch (error) {
        console.error('Error submitting keywords:', error);
      }
    };

    return (
      <div className="discord-embed">
      <div className="embed-title">Available Keywords</div>
      <div className="embed-content">
        <p className="help-text">
          Toggle keywords to select them for your ad. These will be used to train the AI Agent on the keywords best aligned with your brand.
        </p>
        <div className="scrollable-content">
          <div className="keyword-list">
            {(analysisResults.marketingData.list_of_keywords as unknown as Keyword[]).map((keyword: Keyword, index: number) => (
              <div key={index} className="keyword-item">
                <label className="keyword-label">
                  <input
                    type="checkbox"
                    checked={selectedKeywords.has(JSON.stringify(keyword))}
                    onChange={() => toggleKeyword(keyword)}
                    className="keyword-checkbox"
                  />
                  <span className="keyword-text">
                    {keyword.keyword}
                    {keyword.new && <span className="new-label">NEW</span>}
                  </span>
                  <span className="keyword-meta">
                    <span className="search-volume">
                      Volume: {keyword.search_volume}
                    </span>
                    <span 
                      className="competitiveness"
                      style={{ color: getCompetitivenessColor(keyword.competitiveness) }}
                    >
                      {keyword.competitiveness}
                    </span>
                  </span>
                </label>
              </div>
            ))}
          </div>
        </div>
        <button 
          onClick={handleSubmitKeywords} 
          className="embed-button"
          disabled={selectedKeywords.size === 0}
        >
          Submit Selected Keywords
        </button>
      </div>
      <div className="embed-footer">
        <span>Selected: {selectedKeywords.size} / {analysisResults.marketingData.list_of_keywords.length}</span>
        <span>Last Update: {analysisResults.marketingData.date_written.year}-{analysisResults.marketingData.date_written.month}-{analysisResults.marketingData.date_written.day}</span>
      </div>
    </div>
    );
  };

  const renderUserPersonas = () => {
    if (!analysisResults) return null;
  
    const handlePersonaChange = (index: number, field: 'name' | 'description', value: string) => {
      const newPersonas = [...editedPersonas];
      newPersonas[index] = { ...newPersonas[index], [field]: value };
      setEditedPersonas(newPersonas);
    };
  
    const handleSubmitPersonas = async () => {
      try {
        const response = await fetch(`${API_URL}/updateUserPersonas`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            businessName: analysisResults.businessName,
            userPersonas: editedPersonas,
          }),
        });
  
        if (!response.ok) {
          throw new Error('Failed to update user personas');
        }
  
        const data = await response.json();
        if (data.success) {
          setAnalysisResults(prevResults => ({
            ...prevResults!,
            marketingData: {
              ...prevResults!.marketingData,
              user_personas: editedPersonas,
            },
          }));
          setSelectedSection(null);
        } else {
          throw new Error(data.message || 'Failed to update user personas');
        }
      } catch (error) {
        console.error('Error updating user personas:', error);
        // You might want to show an error message to the user here
      }
    };
  
    const handleDeletePersona = async (index: number) => {
      if (window.confirm("Are you sure you want to delete this user persona?")) {
        try {
          const response = await fetch(`${API_URL}/deleteUserPersona`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              businessName: analysisResults.businessName,
              personaIndex: index,
            }),
          });
  
          if (!response.ok) {
            throw new Error('Failed to delete user persona');
          }
  
          const data = await response.json();
          if (data.success) {
            const newPersonas = editedPersonas.filter((_, i) => i !== index);
            setEditedPersonas(newPersonas);
            setAnalysisResults(prevResults => ({
              ...prevResults!,
              marketingData: {
                ...prevResults!.marketingData,
                user_personas: newPersonas,
              },
            }));
          } else {
            throw new Error(data.message || 'Failed to delete user persona');
          }
        } catch (error) {
          console.error('Error deleting user persona:', error);
          // You might want to show an error message to the user here
        }
      }
    };  
    
    return (
      <div className="discord-embed">
        <div className="embed-title">User Personas</div>
        <div className="embed-content">
          <div className="scrollable-content">
            {editedPersonas.map((persona, index) => (
              <div key={index} className="user-persona">
                <h4>Persona {index + 1}</h4>
                <input
                  type="text"
                  value={persona.name}
                  onChange={(e) => handlePersonaChange(index, 'name', e.target.value)}
                  className="embed-input"
                  placeholder="Name"
                />
                <textarea
                  value={persona.description}
                  onChange={(e) => handlePersonaChange(index, 'description', e.target.value)}
                  className="embed-input"
                  placeholder="Description"
                />
                <button 
                  onClick={() => handleDeletePersona(index)} 
                  className="delete-button"
                  aria-label="Delete persona"
                >
                  X
                </button>
              </div>
            ))}
          </div>
          <button onClick={handleSubmitPersonas} className="embed-button">Submit Changes</button>
        </div>
      </div>
    );
  };

  const handleEditChange = (
    adIndex: number, 
    field: 'headlines' | 'descriptions' | 'website', 
    subIndex: number, 
    value: string
  ) => {
    setEditedAds(prev => {
      const newAds = [...(prev as SelectedAd[])];
      if (!newAds[adIndex]) {
        newAds[adIndex] = { ...selectedAds[adIndex] };
      }
      if (field === 'headlines' || field === 'descriptions') {
        newAds[adIndex][field][subIndex] = value;
      } else {
        newAds[adIndex][field] = value;
      }
      return newAds;
    });
  };

  const toggleEditAdIndex = (index: number) => {
    setEditingAdIndex(prevIndex => (prevIndex === index ? null : index));
  };
  
  const approveAd = (index: number) => {
    setApprovedAds(prev => new Set(prev).add(index));
  };

  const handleRejectAd = (index: number) => {
    setAdsMarkedForDeletion(prev => {
      const newSet = new Set(prev);
      if (newSet.has(index)) {
        // If already marked for deletion, remove the ad from the state
        setSelectedAds(prevAds => prevAds.filter((_, i) => i !== index));
        newSet.delete(index);
      } else {
        // If not marked for deletion, unselect the ad if approved, otherwise mark for deletion
        if (approvedAds.has(index)) {
          setApprovedAds(prev => {
            const newApprovedSet = new Set(prev);
            newApprovedSet.delete(index);
            return newApprovedSet;
          });
        } else {
          newSet.add(index);
        }
      }
      return newSet;
    });
  };

  const saveEdit = async (index: number) => {
    const editedAd = (editedAds as SelectedAd[])[index] || selectedAds[index];
    if (editedAd) {
      const updatedAd = {
        headlines: Array.isArray(editedAd.headlines?.[0]) 
          ? editedAd.headlines[0] 
          : editedAd.headlines || [],
        descriptions: Array.isArray(editedAd.descriptions?.[0]) 
          ? editedAd.descriptions[0] 
          : editedAd.descriptions || [],
        related_keywords: editedAd.related_keywords || [],
        additional_headlines: editedAd.additional_headlines || [],
        additional_descriptions: editedAd.additional_descriptions || [],
        website: editedAd.website || '',
        keywords: editedAd.keywords || [],
        currentHeadlineIndex: editedAd.currentHeadlineIndex || 0,
        currentDescriptionIndex: editedAd.currentDescriptionIndex || 0,
        image: editedAd.logo || null,
        imageAsset: editedAd.imageAsset || null,
        logo: editedAd.logo || null
      };
  
      try {
        // Update the ad in the database
        const storedAnalysis = localStorage.getItem('Analysis')!;
        const parsedAnalysis = JSON.parse(storedAnalysis);
        const response = await fetch(`${API_URL}/updateAd`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            businessName: parsedAnalysis?.businessName,
            adIndex: index,
            updatedAd,
          }),
        });
  
        if (!response.ok) {
          throw new Error('Failed to update ad in database');
        }
  
        const result = await response.json();
  
        if (result.success) {
          // Update state and localStorage
          setSelectedAds(prev => {
            const newAds = [...prev];
            newAds[index] = {
              ...updatedAd,
              logo: updatedAd.logo || undefined  
            } as SelectedAd;
            localStorage.setItem('selectedAds', JSON.stringify(newAds)); 
            return newAds;
          });
  
          setEditingAdIndex(null); // This will close the modal
          setEditedAds(prev => {
            const newEditedAds = [...(prev as (SelectedAd | null)[])];
            newEditedAds[index] = null; 
            return newEditedAds as SelectedAd[] | null;
          });
  
        } else {
          throw new Error('Failed to update ad: ' + result.message);
        }
      } catch (error) {
        console.error('Error updating ad:', error);
      }
    }
  };

  const handleAddAssets = () => {
    setShowAssetModal(true);
  };

  const handleCreateAd = async () => {
    setCreateAdSpinner(true);
    try {
      const storedCampaign = localStorage.getItem('selectedCampaign');
      const campaignName = storedCampaign ? JSON.parse(storedCampaign).name : null;
      const storedAnalysis = localStorage.getItem('Analysis')!;
      const parsedAnalysis = JSON.parse(storedAnalysis);
      if (!campaignName) {
        throw new Error('No campaign selected. Please select a campaign before creating ads.');
      }
  
      const budgetResponse = await fetch(`${API_URL}/getCampaignBudget`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          businessName: parsedAnalysis?.businessName,
          campaignName: campaignName 
        }),
      });
  
      if (!budgetResponse.ok) throw new Error('Failed to fetch campaign budget');
      
      const budgetData = await budgetResponse.json();
      if (!budgetData.success) throw new Error('Failed to get campaign budget');
  
      const dailyBudget = parseFloat(budgetData.budget);
      const fee = calculateFee(dailyBudget);
  
      const isConfirmed = window.confirm(
        `creating this ad through AdAlchemyAI is $${fee.toFixed(2)}. Would you like to make this payment?`
      );
  
      if (isConfirmed) {
        // Store current state in localStorage
        localStorage.setItem('pendingAdCreation', JSON.stringify({
          approvedAds: Array.from(approvedAds),
          selectedAds,
          adCreationStep,
          campaignName
        }));
  
        // Create Stripe checkout session
        const checkoutResponse = await fetch(`${API_URL}/create-checkout-session`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ amount: fee, isExistingCampaign: true }),
        });
  
        if (!checkoutResponse.ok) {
          throw new Error('Failed to create checkout session');
        }
  
        const { id: sessionId } = await checkoutResponse.json();
  
        const stripe = await stripePromise;
        if (!stripe) {
          throw new Error('Stripe failed to load');
        }
  
        const { error } = await stripe.redirectToCheckout({ sessionId });
  
        if (error) {
          throw error;
        }
      } else {
        setCreateAdSpinner(false);
      }
    } catch (error) {
      console.error('Error in ad creation process:', error);
      alert('An error occurred during the ad creation process. Please try again or contact support.');
      setCreateAdSpinner(false);
    }
  };

  const createGoogleAds = async (
    approvedAds: Set<number>, 
    selectedAds: SelectedAd[], 
    campaignName: string, 
    parsedAnalysis: { businessName: string }
  ) => {
    setCreateAdSpinner(true);
    try {
      // Filter out only the approved ads
      const approvedAdsList = Array.from(approvedAds).map(index => selectedAds[index]);
  
      // Prepare the data for each approved ad
      const preparedAds = approvedAdsList.map(ad => ({
        headlines: [...ad.headlines, ...(ad.additional_headlines?.flat() || [])],
        descriptions: [...ad.descriptions, ...(ad.additional_descriptions?.flat() || [])],
        assets: ad.logo ? [ad.logo] : [], 
        keywords: ad.related_keywords || [], 
        website: ad.website,
        campaignName: campaignName
      }));
  
      // Create a new EventSource
      const businessName = parsedAnalysis?.businessName
      const eventSource = new EventSource(`${API_URL}/createGoogleAds?businessName=${encodeURIComponent(businessName)}&ads=${encodeURIComponent(JSON.stringify(preparedAds))}`);
      
      let hasError = false;
  
      eventSource.onmessage = (event) => {
        const data = JSON.parse(event.data);
        switch (data.event) {
          case 'adCreated':
            break;
          case 'adError':
            console.error('Error creating ad:', data.error);
            hasError = true;
            // Display the detailed error message
            alert(`Error creating ad: ${data.error}`);
            break;
          case 'error':
            console.error('Error:', data.error);
            hasError = true;
            alert(`An error occurred: ${data.message}`);
            eventSource.close();
            setCreateAdSpinner(false);
            break;
          case 'complete':
            eventSource.close();
            setCreateAdSpinner(false);
            if (!hasError) {
              setIsSidebarOpen(true);
              setSidebarContent('success');
              handleLogout();
              alert('Google Ads have been created successfully!');
            } else {
              alert('Some ads were created, but errors occurred. Please check the console for details.');
            }
            break;
        }
      };
  
      eventSource.onerror = (error) => {
        console.error('EventSource failed:', error);
        eventSource.close();
        setCreateAdSpinner(false);
        alert('An error occurred while creating Google Ads. Please try again.');
      };
    } catch (error) {
      console.error('Error creating Google Ads:', error);
      setCreateAdSpinner(false);
      alert('An error occurred while creating Google Ads. Please try again.');
    }
  };

  const handleAddPhoto = async () => {
    try {
      // Retrieve the selected campaign from localStorage
      const storedCampaign = localStorage.getItem('selectedCampaign');
      const campaignName = storedCampaign ? JSON.parse(storedCampaign).name : 'Default Campaign Name';
      const storedAnalysis = localStorage.getItem('Analysis')!;
      const parsedAnalysis = JSON.parse(storedAnalysis);
      const response = await fetch(`${API_URL}/getLogoAssets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          businessName: parsedAnalysis?.businessName,
          campaignName 
        }),
      });

      if (!response.ok) throw new Error('Failed to fetch logo assets');
      const data = await response.json();
      setLogoAssets(data.assets);
      setShowLogoAssetsModal(true); 
    } catch (error) {
      console.error('Error fetching logo assets:', error);
      // Optionally, show an error message to the user
    }
  };

  const handleSelectLogo = (asset: string) => {
    if (editingAdIndex === null) return;  
    const newAds = [...selectedAds];
    newAds[editingAdIndex] = {
      ...newAds[editingAdIndex],
      logo: asset,
    };
    setSelectedAds(newAds);
    setShowLogoAssetsModal(false);
    localStorage.setItem('selectedAds', JSON.stringify(newAds));
  };

  const handleRemoveLogo = (index: number) => {
    const newAds = [...selectedAds];
    newAds[index] = {
      ...newAds[index],
      logo: null,
    };
    setSelectedAds(newAds);
    localStorage.setItem('selectedAds', JSON.stringify(newAds));
  };

  useEffect(() => {
    console.log('showBudgetModal updated:', showBudgetModal);
  }, [showBudgetModal]);

  // const handleEditBudget = async () => {
  //   const storedCampaign = localStorage.getItem('selectedCampaign');
  //   const campaignName = storedCampaign ? JSON.parse(storedCampaign).name : 'Default Campaign Name';

  //   if (!campaignName) {
  //     console.error('No campaign selected');
  //     return;
  //   }
  //   setIsLoadingBudget(true);
  //   try {
  //     const response = await fetch(`${API_URL}/getCampaignBudget`, {
  //       method: 'POST',
  //       headers: {
  //         'Content-Type': 'application/json',
  //       },
  //       body: JSON.stringify({ 
  //         businessName,
  //         campaignName: campaignName 
  //       }),
  //     });

  //     if (!response.ok) throw new Error('Failed to fetch campaign budget');
      
  //     const data = await response.json();
  //     if (data.success) {
  //       setCurrentBudget(data.budget);
  //       setShowBudgetModal(true);
  //     }
  //   } catch (error) {
  //     console.error('Error fetching campaign budget:', error);
  //   } finally {
  //     setIsLoadingBudget(false)
  //   }
  // };

  const renderLogoGrid = () => {
    if (!showLogoGrid) return null;
  
    return (
      <div className="logo-grid-container">
        <h2>Logo Assets</h2>
        <div className="logo-grid">
          {logoAssets.map((asset, index) => (
            <div key={index} className="logo-item">
              <img src={asset} alt={`Logo ${index + 1}`} />
            </div>
          ))}
        </div>
        <button onClick={() => setShowLogoGrid(false)} className="close-grid-button">
          Close
        </button>
      </div>
    );
  };

  const calculateFee = (dailyBudget: number): number => {
    if (dailyBudget <= 100) {
      return dailyBudget * 0.07;
    } else if (dailyBudget <= 499) {
      return dailyBudget * 0.05;
    } else {
      return dailyBudget * 0.04;
    }
  };
  
  const handleCreateNewCampaign = async () => {
    const result = campaignSchema.safeParse(newCampaignData);
    const storedAnalysis = localStorage.getItem('Analysis')!;
    const parsedAnalysis = JSON.parse(storedAnalysis);

      if (result.success) {
      setErrors({});
      try {
        const response = await fetch(`${API_URL}/createCampaign`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            businessName: parsedAnalysis?.businessName,
            ...newCampaignData
          }),
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Failed to create campaign');
        // Update campaigns list
        setCampaigns(prevCampaigns => [...prevCampaigns, {
          'Campaign ID': data.campaignId,
          'Campaign Name': newCampaignData.campaignName,
          'Budget': parseFloat(newCampaignData.dailyBudget)
        }]);

        // Set the selected campaign
        const newCampaign = { id: data.campaignId, name: newCampaignData.campaignName };
        setSelectedCampaign(newCampaign);
        localStorage.setItem('selectedCampaign', JSON.stringify(newCampaign));

        // Clear the form
        setNewCampaignData({
          campaignName: '',
          dailyBudget: '',
          startDate: '',
          endDate: ''
        });

        // Open the sidebar and set content to 'authenticated'
        setIsSidebarOpen(true);
        setSidebarContent('authenticated');

        // Start ad creation process
        setIsCreatingAds(true);
        await createAds(1);
      } catch (error) {
        console.error('Error creating campaign:', error);
        alert('Failed to create campaign. Please try again.');
      } finally {
        setIsCreatingCampaign(false);
      }
    } else {
      setErrors(result.error.flatten().fieldErrors);
    }
  };

  const cycleEditableHeadline = (adIndex: number, direction: number) => {
    setEditedAds(prev => {
      const newAds = [...(prev as SelectedAd[])];
      if (!newAds[adIndex]) {
        newAds[adIndex] = { ...selectedAds[adIndex], currentHeadlineIndex: 0 };
      }
      const ad = newAds[adIndex];
      const totalHeadlines = (ad.headlines?.length || 0) + (ad.additional_headlines?.flat().length || 0);
      ad.currentHeadlineIndex = (ad.currentHeadlineIndex + direction + totalHeadlines) % totalHeadlines;
      return newAds;
    });
  };
  
  const cycleEditableDescription = (adIndex: number, direction: number) => {
    setEditedAds(prev => {
      const newAds = [...(prev as SelectedAd[])];
      if (!newAds[adIndex]) {
        newAds[adIndex] = { ...selectedAds[adIndex], currentDescriptionIndex: 0 };
      }
      const ad = newAds[adIndex];
      const totalDescriptions = (ad.descriptions?.length || 0) + (ad.additional_descriptions?.flat().length || 0);
      ad.currentDescriptionIndex = (ad.currentDescriptionIndex + direction + totalDescriptions) % totalDescriptions;
      return newAds;
    });
  };
  
  const renderAdCreationStep = () => {
    switch (adCreationStep) {
      case 'checkCredentials':
        return (
          <div className="discord-embed">
            <div className="embed-title">Checking Credentials</div>
            <div className="embed-content">
              <p>Please wait while we check your Google Ads credentials...</p>
            </div>
          </div>
        );
      case 'requiresAuth':
        return (
          <div className="discord-embed">
            <div className="embed-title">Authentication Required</div>
            <div className="embed-content">
              <p>You need to authenticate with Google Ads.</p>
              <button onClick={authenticate} className="embed-button">
                Start Authentication
              </button>
            </div>
          </div>
        );
      case 'selectCampaignOption':
        return (
          <div className="discord-embed">
            <div className="embed-title">Select Campaign Option</div>
            <div className="embed-content">
              <button onClick={() => updateAdCreationStep('selectExistingCampaign')} className="embed-button">
                Use Existing Campaign
              </button>
              <button onClick={() => updateAdCreationStep('createNewCampaign')} className="embed-button">
                Create New Campaign
              </button>
            </div>
          </div>
        );
      case 'loadingCampaigns':
        return (
          <div className="discord-embed">
            <div className="embed-title">Loading Campaigns</div>
            <div className="embed-content">
              <p>Please wait while we fetch your existing campaigns...</p>
            </div>
          </div>
        );
        case 'createNewCampaign':
          return (
            <div className="discord-embed">
              <div className="embed-title">Create New Campaign</div>
              <div className="embed-content">
                {isCreatingAds ? (
                  <div className="spinner-container">
                    <SyncLoader color="#ffffff" size={15} />
                    <p>Creating campaign...</p>
                  </div>
                ) : (
                  <div className="new-campaign-form">
                    {errors.campaignName && <span className="error">{errors.campaignName[0]}</span>}
                    <input
                      type="text"
                      placeholder="Campaign Name"
                      value={newCampaignData.campaignName}
                      onChange={(e) => {
                        setNewCampaignData({...newCampaignData, campaignName: e.target.value});
                        setErrors(prev => {
                          const newErrors = { ...prev };
                          delete newErrors.campaignName;
                          return newErrors;
                        });
                      }}
                      className="embed-input"
                    />
                    {errors.dailyBudget && <span className="error">{errors.dailyBudget[0]}</span>}
                    <input
                      type="number"
                      placeholder="Daily Budget ($)"
                      value={newCampaignData.dailyBudget}
                      onChange={(e) => {
                        setNewCampaignData({...newCampaignData, dailyBudget: e.target.value});
                        setErrors(prev => {
                          const newErrors = { ...prev };
                          delete newErrors.dailyBudget;
                          return newErrors;
                        });
                      }}
                      className="embed-input"
                    />
                    {errors.startDate && <span className="error">{errors.startDate[0]}</span>}
                    <input
                      type="date"
                      placeholder="Start Date"
                      value={newCampaignData.startDate}
                      onChange={(e) => {
                        setNewCampaignData({...newCampaignData, startDate: e.target.value});
                        setErrors(prev => {
                          const newErrors = { ...prev };
                          delete newErrors.startDate;
                          return newErrors;
                        });
                      }}
                      className="embed-input"
                    />
                    {errors.endDate && <span className="error">{errors.endDate[0]}</span>}
                    <input
                      type="date"
                      placeholder="End Date"
                      value={newCampaignData.endDate}
                      onChange={(e) => {
                        setNewCampaignData({...newCampaignData, endDate: e.target.value});
                        setErrors(prev => {
                          const newErrors = { ...prev };
                          delete newErrors.endDate;
                          return newErrors;
                        });
                      }}
                      className="embed-input"
                    />
                    <div className="campaign-action-buttons">
                      <button onClick={handleCreateNewCampaign} className="embed-button">
                        Create Campaign
                      </button>
                      <button 
                        onClick={() => {
                          setNewCampaignData({
                            campaignName: '',
                            dailyBudget: '',
                            startDate: '',
                            endDate: ''
                          });
                          setErrors({});
                          updateAdCreationStep('selectCampaignOption');
                        }} 
                        className="embed-button"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        case 'selectExistingCampaign':
        return (
          <div className="discord-embed">
            <div className="embed-title">Select Existing Campaign</div>
            <div className="embed-content">
              {isLoadingCampaigns ? (
                <p>Loading campaigns...</p>
              ) : isCreatingAds ? (
                <div className="spinner-container">
                  <SyncLoader color="#ffffff" size={15} />
                  <p>Creating ads...</p>
                </div>
              ) : (
                <>
                  {campaigns.length > 0 ? (
                    <div className="campaign-list">
                      {campaigns.map(campaign => (
                        <div 
                          key={campaign['Campaign ID']} 
                          onClick={() => handleCampaignSelect({
                            id: campaign['Campaign ID'].toString(),
                            name: campaign['Campaign Name']
                          })} 
                          className="campaign-item"
                        >
                          <div>ID: {campaign['Campaign ID']}</div>
                          <div className="campaign-name">{campaign['Campaign Name']}</div>
                          <div>Budget: ${campaign['Budget'].toFixed(2)}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p>No campaigns found. Please create a new campaign.</p>
                  )}
                </>
              )}
            </div>
          </div>
        );      
      case 'authenticating':
        return (
          <div className="discord-embed">
            <div className="embed-title">Authenticating</div>
            <div className="embed-content">
              <p className="thinking">Authenticating using your Google credentials...</p>
            </div>
          </div>
        );
      case 'displaySelectedAds':
        return (
          <div className="discord-embed">
            <div className="embed-title">
              <div className="title-with-doodle">
                <span>Selected Ads</span>
                {googleDoodleUrl && (
                  <img 
                    src={googleDoodleUrl} 
                    alt="Google Doodle" 
                    className="google-doodle"
                  />
                )}
              </div>
            </div>
            <div className="embed-content">
              {selectedAds.map((ad, index) => (
                <div
                  key={index}
                  className={`google-ad-preview ${approvedAds.has(index) ? 'approved' : ''} ${adsMarkedForDeletion.has(index) ? 'marked-for-deletion' : ''}`}
                >
                  {editingAdIndex === index ? (
                    <div className="ad-content">
                      <div className="editable-field">
                        <button onClick={() => cycleEditableHeadline(index, -1)} className="cycle-button">←</button>
                        <input
                          type="text"
                          value={(editedAds as SelectedAd[])[index]?.headlines?.[(editedAds as SelectedAd[])[index]?.currentHeadlineIndex || 0] || ad.headlines?.[ad.currentHeadlineIndex || 0] || ''}
                          onChange={(e) => handleEditChange(index, 'headlines', (editedAds as SelectedAd[])[index]?.currentHeadlineIndex || 0, e.target.value)}                 
                          className="embed-input"
                          style={{ color: 'black', backgroundColor: 'grey'}}
                        />
                        <button onClick={() => cycleEditableHeadline(index, 1)} className="cycle-button">→</button>
                      </div>
                      <input
                        type="text"
                        value={(editedAds as SelectedAd[])[index]?.website || ad.website || ''}
                        onChange={(e) => handleEditChange(index, 'website', 0, e.target.value)}                  
                        className="embed-input"
                        style={{ color: 'black', backgroundColor: 'grey'}}
                      />
                      <div className="editable-field">
                        <button onClick={() => cycleEditableDescription(index, -1)} className="cycle-button">←</button>
                        <textarea
                          value={(editedAds as SelectedAd[])[index]?.descriptions?.[(editedAds as SelectedAd[])[index]?.currentDescriptionIndex || 0] || ad.descriptions?.[ad.currentDescriptionIndex || 0] || ''}
                          onChange={(e) => handleEditChange(index, 'descriptions', (editedAds as SelectedAd[])[index]?.currentDescriptionIndex || 0, e.target.value)}
                          className="embed-textarea"
                        />
                        <button onClick={() => cycleEditableDescription(index, 1)} className="cycle-button">→</button>
                      </div>
                      <div className="asset-buttons">
                        <div className="asset-button-container">
                          {ad.logo ? (
                            <div className="selected-logo">
                              <img src={ad.logo} alt="Selected Logo" className="selected-logo-img" />
                              <button onClick={() => handleRemoveLogo(index)} className="remove-logo-button">x</button>
                            </div>
                          ) : (
                            <button onClick={() => handleAddPhoto()} className="asset-button photo-button">
                              +
                            </button>
                          )}
                          <span className="asset-label">Photo</span>
                        </div>
                      </div>
                      <div className="edit-buttons">
                        <button onClick={() => saveEdit(index)} className="embed-button">Save</button>
                        <button onClick={() => setEditingAdIndex(null)} className="embed-button">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className="ad-content">
                      {ad.logo && (
                        <div className="ad-logo-container">
                          <img src={ad.logo} alt="Ad Logo" className="ad-logo" />
                        </div>
                      )}
                      <div className="ad-headline">
                        <button onClick={() => cycleHeadline(index, -1)} className="cycle-button">←</button>
                        {ad.currentHeadlineIndex < ad.headlines.length 
                          ? ad.headlines[ad.currentHeadlineIndex] 
                          : ad.additional_headlines?.flat()[ad.currentHeadlineIndex - ad.headlines.length]}
                        <button onClick={() => cycleHeadline(index, 1)} className="cycle-button">→</button>
                      </div>
                      <div className="ad-url">{ad.website || ''}</div>
                      <div className="ad-description">
                      <button onClick={() => cycleDescription(index, -1)} className="cycle-button">←</button>
                      {ad.currentDescriptionIndex < ad.descriptions.length 
                        ? ad.descriptions[ad.currentDescriptionIndex] 
                        : ad.additional_descriptions?.flat()[ad.currentDescriptionIndex - ad.descriptions.length]}
                      <button onClick={() => cycleDescription(index, 1)} className="cycle-button">→</button>
                    </div>
                    </div>
                  )}
                  {editingAdIndex !== index && (  
                  <div className="ad-hover-controls">
                    <button onClick={() => { toggleEditAdIndex(index); setIsEditMode(true); }} className="edit-button">Edit</button>
                    <div className="ad-decision-buttons">
                      {!approvedAds.has(index) && (
                        <button className="approve-button" onClick={() => approveAd(index)}>✓</button>
                      )}
                      <button className="reject-button" onClick={() => handleRejectAd(index)}>✗</button>
                    </div>
                  </div>
                   )}
                </div>
              ))}
            </div>
            <div className="action-buttons">
            {selectedAds.length > 0 && (
              <>
                <button className="add-assets-button" onClick={handleAddAssets}>
                  Add Assets to Ads
                </button>
                <button className="add-assets-button" onClick={handleCreateAd} disabled={createAdSpinner}>
                  {createAdSpinner ? <SyncLoader color="#ffffff" size={8} /> : "Create Ad"}
                </button>
                {/* <button 
                  className="add-assets-button" 
                  onClick={handleEditBudget}
                  disabled={isLoadingBudget}
                >
                  {isLoadingBudget ? (
                    <SyncLoader color="#ffffff" size={8} margin={2} />
                  ) : (
                    'Edit Campaign Budget'
                  )}
                </button>  */}
              </>
            )}
          </div>
          </div>
        );
      case 'error':
        return (
          <div className="discord-embed">
            <div className="embed-title">Error</div>
            <div className="embed-content">
              <p>An error occurred during the ad creation process. Please try again.</p>
              <button onClick={startAdCreation} className="embed-button">
                Retry
              </button>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  const renderBotContent = () => {  
    if (!sessionId) {
      return (
        <>
          <h2>Welcome to AdAlchemyAI</h2>
          <button onClick={startSession} disabled={isLoading}>Start Session</button>
        </>
      );
    }

    return (
      <>
        <h2>{analysisStarted ? 'Average Wait Time' : 'AdAlchemyAI'}</h2>
        {analysisStarted && (
          <div className="timer">
            {Math.floor(remainingTime / 60)}:{(remainingTime % 60).toString().padStart(2, '0')}
          </div>
        )}
        <div className="chat-simulation" ref={chatContainerRef}>
          {!analysisStarted && messages.map((message, index) => (
            <div key={index}>
              <p className={message.isBot ? 'bot-message' : 'user-message'}>
                {message.isBot && <img src={logo} alt="AdAlchemyAI Logo" className="chat-logo" />}
                <strong>{message.isBot ? 'AdAlchemyAI: ' : 'You: '}</strong>
                <span dangerouslySetInnerHTML={{ __html: message.content }} />
              </p>
              {showYesNo && message.isBot && message.content.includes("Do you consent to this information being sent to you via email") && (
                <div className="yes-no-buttons">
                  <button onClick={() => handleYesNo('Yes')}>Yes</button>
                  <button onClick={() => handleYesNo('No')}>No</button>
                </div>
              )}
            </div>
          ))}
          {analysisStarted && (
            <div className="thinking-animation">
              <span className="animated-text">{currentThinkingStep}</span>
              <span className="dots">...</span>
            </div>
          )}
        </div>
        {!showYesNo && !analysisStarted && (
          <div className="input-container">
            <input 
              type="text" 
              placeholder="Type your message..."
              onKeyPress={(e) => {
                if (e.key === 'Enter') {
                  sendMessage(e.currentTarget.value);
                  e.currentTarget.value = '';
                }
              }}
              disabled={isInputDisabled}
            />
          </div>
        )}
        <button onClick={endSession} disabled={isLoading || analysisStarted}>End Session</button>
      </>
    );
  };

  const InfoContent = () => {
    const initialText = `  is an AI Worker that helps you get leads by enabling you to create, run and optimize Google Ads by just typing in one word.

AdAlchemyAI at the core is a series of AI Agents that:
- learn about your business, defines user personas
- researches the best keywords to use to run a good ad
- researches ad text variations that best match your brand
- runs ads for you
- optimizes your ads, returning ad performance and suggesting changes to improve your ad

You interact with AdAlchemyAI through a discord bot. By manually approving this output, you train the worker to better understand your business and generate better ads.`;
  
    const formattedText = (faqContent || initialText).split('\n').join('<br />');
    const typedText = useTypingEffect(formattedText, 10);

    return (
      <>
        <h2>What is AdAlchemyAI?</h2>
        <div className="chat-simulation" ref={chatContainerRef}>
          <p className="bot-message">
            <img src={logo} alt="AdAlchemyAI Logo" className="logo" />
            <strong>AdAlchemyAI: </strong>
            <span dangerouslySetInnerHTML={{ __html: typedText }}></span>
          </p>
        </div>
        <div className="faq-section">
          <FAQItem 
            question="What is AdAlchemyAI?" 
            content={initialText}
          />
          <FAQItem 
            question="How does it work?" 
            content="  You use AdAlchemyAI through a Discord bot. You use this bot to; train each AI Agent - think of each AI Agent as an employee in your personal Ad Agency, all working to help you create good ads.

With the Discord bot you can also view how your ad is performing, create a new ad (generated by AI and selected by you), select keywords that best align with your business and edit the ad text generated by AI.

With the home page, you will go through our onboarding. After this our first two Agents, generating insights on:
- what your business does
- your user personas
- paths AI will use that simulate how potential users could find your product
- keywords it would generate to create an ad for you
- ad text variations it generates to create your ad

This output will be sent to you via email in about 5-10 minutes. You can view the output, see if it's relevant. If you like what you see, you can book a time to complete our onboarding process"
          />
          <FAQItem 
            question="How does it help me?" 
            content="  helps you get good leads without having to hire a digital marketer, saving you money and helping you grow your business"
          />
          <FAQItem 
            question="How do I sign up?" 
            content='  You can complete the onboarding process on this site by clicking "Let me test it" or, schedule an onboarding call using this link: <a href="https://calendly.com/emmanuel-emmanuelsibanda/30min" target="_blank" rel="noopener noreferrer">Schedule Onboarding</a>'
          />
          <FAQItem 
            question="What do I pay?" 
            content="  Our pricing is tailored to your individual needs. Let's start off by onboarding you and scheduling a call to understand your needs"
          />
        </div>
      </>
    );
  };

  const renderAnalysisProgress = () => {
    if (analysisInProgress) {
      return (
        <div className="analysis-progress">
          <SyncLoader color="#ffffff" size={15} />
          <p>{currentAnalysisStep}</p>
        </div>
      );
    }
    return null;
  };

  const handleBudgetUpdate = async (newBudget: number) => {
    const storedCampaign = localStorage.getItem('selectedCampaign');
    const campaignName = storedCampaign ? JSON.parse(storedCampaign).name : 'Default Campaign Name';

    if (!campaignName) {
      console.error('No campaign selected');
      return;
    }

    try {
      const response = await fetch(`${API_URL}/updateCampaignBudget`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          businessName,
          campaignName,
          newBudget 
        }),
      });

      if (!response.ok) throw new Error('Failed to update campaign budget');
      const data = await response.json();
      console.log('Budget updated successfully:', data);
      setCurrentBudget(newBudget);
      setShowBudgetModal(false);
    } catch (error) {
      console.error('Error updating campaign budget:', error);
    }
  };

  const handleAssetSubmit = () => {
    if (selectedAsset && editingAdIndex !== null) {
      // Update the ad with the selected asset
      const newAds = [...selectedAds];
      newAds[editingAdIndex] = {
        ...newAds[editingAdIndex],
        logo: selectedAsset,
      };
      setSelectedAds(newAds);
    }
    setShowAssetModal(false);
    setSelectedAsset(null);
  };

  return (
      <div className="container">
        <header className="header">
          <img src={logo} alt="AdAlchemyAI Logo" className="header-logo" />
        </header>
        <main className={isSidebarOpen ? 'with-sidebar' : ''}>
          {renderAnalysisProgress()}
          <h1 className="gradient-text">
            { user ? businessName: "AdAlchemyAI" }
          </h1>
          <p><strong>
            { user
            ? businessDescription
          : "Hire an AI Worker to help your small business get more leads by automating your Google Ads"
          }
          </strong></p>
          <div className="button-group">
            <button className="cta-button" onClick={() => toggleSidebar('test')}>
              {isSidebarOpen && sidebarContent === 'test' ? 'Close Sidebar' : 'Run an Ad'}
            </button>
            <button className="cta-button" onClick={() => toggleSidebar('info')}>
                {isSidebarOpen && sidebarContent === 'info' ? 'Close Sidebar' : 'What is AdAlchemyAI'}
            </button>
            {localStorage.getItem('userLoggedIn') === 'true' && (
              <button className="cta-button" onClick={handleLogout}>
                  Logout
              </button>
            )}
          </div>
        </main>
        <div className={`sidebar ${isSidebarOpen ? 'open' : ''}`}>
          {isLoading && <p>Loading...</p>}
          {renderSidebarContent()}
        </div>
        {alertMessage && (
          <div className="alert">
            <span>{alertMessage}</span>
            <button onClick={handleDismissClick}>X</button>
          </div>
        )}
        {showLoginButton && alertMessage && (
          <div className="login-button-container">
            <button onClick={handleLoginClick} className="login-button">
              Sign in with Google
            </button>
          </div>
        )}
        {renderAdCreationStep()}

        {renderLogoGrid()}
        <AssetModal
          show={showAssetModal}
          onClose={() => setShowAssetModal(false)}
          onSubmit={handleAssetSubmit}
        />
        <LogoAssetsModal
          show={showLogoAssetsModal}
          onClose={() => setShowLogoAssetsModal(false)}
          assets={logoAssets.map(url => ({ url }))}
          onSelect={handleSelectLogo}
        />
        <EditBudgetModal
          show={showBudgetModal}
          onClose={() => setShowBudgetModal(false)}
          onSubmit={handleBudgetUpdate}
          campaignName={selectedCampaign?.name || 'Unknown Campaign'}
          currentBudget={currentBudget}
        />
        <NewCampaignModal
          show={showNewCampaignModal}
          onClose={() => setShowNewCampaignModal(false)}
          onSubmit={handleCreateNewCampaign}
          campaignData={newCampaignData}
          setCampaignData={setNewCampaignData}
        />
        <CustomerIdModal
          show={showCustomerIdModal}
          onClose={() => setShowCustomerIdModal(false)}
          onSubmit={updateCustomerId}
        />
        <p className="asset-instruction">
          Once you have added assets, you can click the + (photo)
        </p>
      </div>
  );
}

export default App;