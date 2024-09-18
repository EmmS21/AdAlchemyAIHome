import React, { useState, useEffect, useRef } from 'react';
import './App.css';
import logo from './assets/adalch.jpg';
import useTypingEffect from './hooks/useTypingEffect';

function App() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [sidebarContent, setSidebarContent] = useState<'test' | 'info' | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Array<{ content: string, isBot: boolean }>>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showYesNo, setShowYesNo] = useState(false);
  const [faqContent, setFaqContent] = useState<string | null>(null);

  const chatContainerRef = useRef<HTMLDivElement>(null);
  
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
  
  const toggleSidebar = (content: 'test' | 'info') => {
    setSidebarContent(content);
    setIsSidebarOpen(!isSidebarOpen);
  };
  
  const API_URL = import.meta.env.MODE === 'production' 
  ? import.meta.env.VITE_API_URL_PROD 
  : import.meta.env.VITE_API_URL_DEV;

  const formatBotMessage = (content: string) => {
    const parts = content.split(/(\d+\.)/);
    return parts.map((part) => {
      if (/^\d+\.$/.test(part)) {
        return `<br/><span class="large-number">${part}</span> `;
      }
      return part;
    }).join('');
  };

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
        setMessages(data.initialMessages.map((msg: string) => ({ content: parseMessage(msg), isBot: true })));
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
      });
      const data = await response.json();
      if (data.success) {
        const newMessages = data.messages.map((msg: { content: string, isBot: boolean }) => ({
          content: parseMessage(msg.content),
          isBot: msg.isBot,
        }));
        setMessages((prevMessages) => [...prevMessages, ...newMessages]);
        if (newMessages.some((msg: { content: string | string[]; }) => msg.content.includes("Do you consent to this information being sent to you via email"))) {
          setShowYesNo(true);
        } else {
          setShowYesNo(false);
        }
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
        <h2>Bot Interaction</h2>
        <div className="chat-simulation" ref={chatContainerRef}>
          {messages.map((message, index) => (
            <div key={index}>
              <p className={message.isBot ? 'bot-message' : 'user-message'}>
                {message.isBot && <img src={logo} alt="AdAlchemyAI Logo" className="chat-logo" />}
                <strong>{message.isBot ? 'AdAlchemyAI: ' : 'You: '}</strong>
                {message.isBot && message.content.includes("Our Company Researcher agent") ? (
                  <span dangerouslySetInnerHTML={{ __html: formatBotMessage(message.content) }} />
                ) : (
                  <span dangerouslySetInnerHTML={{ __html: message.content }} />
                )}
              </p>
              {showYesNo && message.isBot && message.content.includes("Do you consent to this information being sent to you via email") && (
                <div className="yes-no-buttons">
                  <button onClick={() => handleYesNo('Yes')}>Yes</button>
                  <button onClick={() => handleYesNo('No')}>No</button>
                </div>
              )}
            </div>
          ))}
        </div>
        {!showYesNo && (
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
            />
          </div>
        )}
        <button onClick={endSession} disabled={isLoading}>End Session</button>
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

  return (
    <div className="container">
      <header className="header">
        <img src={logo} alt="AdAlchemyAI Logo" className="header-logo" />
      </header>
      <main className={isSidebarOpen ? 'with-sidebar' : ''}>
        <h1 className="gradient-text">
          AdAlchemyAI
        </h1>
        <p><strong>Hire an AI Worker to help your small business get more leads by automating your Google Ads</strong></p>
        <div className="button-group">
          <button className="cta-button" onClick={() => toggleSidebar('test')}>
            {isSidebarOpen && sidebarContent === 'test' ? 'Close Sidebar' : 'Let me test it'}
          </button>
          <button className="cta-button" onClick={() => toggleSidebar('info')}>
            {isSidebarOpen && sidebarContent === 'info' ? 'Close Sidebar' : 'What is AdAlchemyAI'}
          </button>
        </div>
      </main>
      <div className={`sidebar ${isSidebarOpen ? 'open' : ''}`}>
        {isLoading && <p>Loading...</p>}
        {sidebarContent === 'test' && renderBotContent()}
        {sidebarContent === 'info' && <InfoContent />}
      </div>
    </div>
  );
}

export default App;