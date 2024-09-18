import React, { useState, useEffect, useRef } from 'react';
import './App.css';
import logo from './assets/adalch.jpg'; // Import the logo

function App() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [sidebarContent, setSidebarContent] = useState<'test' | 'info' | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Array<{ content: string, isBot: boolean }>>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showYesNo, setShowYesNo] = useState(false);

  const chatContainerRef = useRef<HTMLDivElement>(null);

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
    return content.replace(linkRegex, (match, text, url) => {
      return `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    });
  };
  
  const toggleSidebar = (content: 'test' | 'info') => {
    setSidebarContent(content);
    setIsSidebarOpen(!isSidebarOpen);
  };
  
  const API_URL = process.env.NODE_ENV === 'production' 
  ? process.env.REACT_APP_API_URL_PROD 
  : process.env.REACT_APP_API_URL_DEV;

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
                <span dangerouslySetInnerHTML={{ __html: message.content }}></span>
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

  const renderInfoContent = () => (
    <>
      <h2>What is AdAlchemyAI?</h2>
      <div className="chat-simulation" ref={chatContainerRef}>
        <p className="bot-message">
          <img src={logo} alt="AdAlchemyAI Logo" className="logo" />
          <strong>AdAlchemyAI: </strong>
          AdAlchemyAI is an AI Worker that helps you get leads by enabling you to create, run and optimize Google Ads by just typing in one word.

          AdAlchemyAI at the core is a series of AI Agents that:
          <ul>
            <li>learn about your business, defines user personas</li>
            <li>researches the best keywords to use to run a good ad</li>
            <li>researches ad text variations that best match your brand</li>
            <li>runs ads for you</li>
            <li>optimizes your ads, returning ad performance and suggesting changes to improve your ad</li>
          </ul>

          You interact with AdAlchemyAI through a discord bot. By manually approving this output, you train the worker to better understand your business and generate better ads.
        </p>
      </div>
    </>
  );

  return (
    <div className="container">
      <header className="header">
        <img src={logo} alt="AdAlchemyAI Logo" className="header-logo" />
      </header>
      <main className={isSidebarOpen ? 'with-sidebar' : ''}>
        <h1>
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
        {sidebarContent === 'info' && renderInfoContent()}
      </div>
    </div>
  );
}

export default App;