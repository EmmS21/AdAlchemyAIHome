const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');
const axios = require('axios');
require('dotenv').config();

const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
const { monitorAndSendEmails } = require('./emailNotifier'); // Import the function

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const mongoClient = new MongoClient(process.env.MONGODB_URI);
const lambdaClient = new LambdaClient({ region: process.env.AWS_REGION });

async function connectToMongo() {
  try {
    await mongoClient.connect();
    console.log('Connected to MongoDB');
  } catch (error) {
    console.error('Failed to connect to MongoDB:', error);
  }
}

connectToMongo();

// Simulated bot responses
const botResponses = [
  "Hello! I am AdAlchemyAI, a bot to help you get good leads for a cost-effective price for your business by automating the process of setting up, running, and optimizing your Google Ads. I only run ads after you manually approve the keywords I researched, the ad text ideas I generate, and the information I use to carry out my research. But for now, I would like to learn more about you and your business.",
  "What is the name of your business?"
];

app.post('/startSession', async (req, res) => {
  try {
    const sessionId = Math.random().toString(36).substring(7);

    // Only store session ID and creation time initially
    const db = mongoClient.db('onboarding');
    const sessionsCollection = db.collection('sessions');
    await sessionsCollection.insertOne({
      sessionId,
      createdAt: new Date(),
      currentStep: 0,
    });

    res.json({ success: true, sessionId, initialMessages: botResponses });
  } catch (error) {
    console.error('Error starting session:', error);
    res.status(500).json({ success: false, message: `Failed to start session: ${error.message}` });
  }
});

app.post('/sendMessage', async (req, res) => {
  const { sessionId, message } = req.body;

  try {
    const db = mongoClient.db('onboarding');
    const sessionsCollection = db.collection('sessions');
    const session = await sessionsCollection.findOne({ sessionId });

    if (!session) {
      return res.status(404).json({ success: false, message: 'Session not found. Please start a new session.' });
    }

    let botReply = '';
    let nextStep = session.currentStep + 1;
    let businessInfo = session.businessInfo || {};

    switch (session.currentStep) {
      case 0:
        // Check for duplicate business name
        const duplicateBusinessName = await sessionsCollection.findOne({ 'businessInfo.name': message });
        if (duplicateBusinessName) {
          botReply = "The business name you provided already exists. Please provide a different business name.";
          nextStep = 0; // Stay on the same step
        } else {
          businessInfo.name = message;
          botReply = `Please give me a link to your website ${message}:`;
        }
        break;
      case 1:
        try {
          const response = await axios.get(message);
          const content = response.data.toLowerCase();
          const invalidKeywords = ["domain for sale", "buy this domain", "this domain is for sale", "this domain is parked"];

          // Check for duplicate website
          const duplicateWebsite = await sessionsCollection.findOne({ 'businessInfo.website': message });
          if (duplicateWebsite) {
            botReply = "The website you provided already exists. Please provide a different website.";
            nextStep = 1; // Stay on the same step
          } else if (response.status === 200 && !invalidKeywords.some(keyword => content.includes(keyword))) {
            businessInfo.website = message;
            botReply = "Could you please provide your email address?";
          } else {
            throw new Error('Website is not valid or is for sale');
          }
        } catch (error) {
          botReply = "The website you provided is not reachable or is for sale. Please provide a valid website link.";
          nextStep = 1; // Stay on the same step
        }
        break;
      case 2:
        if (validateEmailSyntax(message)) {
          // Check for duplicate email
          const duplicateEmail = await sessionsCollection.findOne({ 'businessInfo.email': message });
          if (duplicateEmail) {
            botReply = "The email address you provided already exists. Please provide a different email address.";
            nextStep = 2; // Stay on the same step
          } else {
            businessInfo.email = message;
            botReply = "Our company researcher will use the information to understand your business and users. Do you consent to this information being sent to you via email (this will be sent to you only once)?";
            nextStep = 3; // Move to the next step for Yes/No response
          }
        } else {
          botReply = "The email address format is not valid. Please provide a valid email address.";
          nextStep = 2; // Stay on the same step
        }
        break;
      case 3:
        if (message.toLowerCase() === 'yes') {
          botReply = `Our Company Researcher agent will use this information available to build up an understanding of your business, define your user personas and build out a list of research paths that our market researcher will use to build our keywords and ad text for your business.

Within 10 minutes you will receive an email with:
1. A description of your business
2. A description of your user personas
3. Research paths used by our market researcher to find keywords for you
4. A list of keywords generated by our AI Agent for your Ads
5. Variations of Ad Text
6. A Calendly link if you are interested in learning more about our AI Worker and using our production level bot to help you run and optimize Google Ads`;

          // Only update the session document after completing all questions
          await sessionsCollection.updateOne(
            { sessionId },
            { 
              $set: { 
                businessInfo: businessInfo,
                currentStep: nextStep,
                emailSent: false,
                onboardingCompleted: true // New field to indicate completion
              }
            }
          );

          // Trigger the Lambda function
          await triggerLambdaFunction(businessInfo);
        } else {
          botReply = "Thank you for your response. If you change your mind, feel free to start a new session.";
          nextStep = -1; // End of onboarding
        }
        break;
      case 4:
        botReply = "A mapping has been made between your ID and your business. This helps us remember you. Let's book some time to complete your onboarding and chat more about your business. Click the link below to schedule an appointment with us: [Calendly Scheduling Link]";
        nextStep = -1; // End of onboarding
        break;
      default:
        botReply = "Thank you for your interest. Our team will be in touch with you soon.";
        nextStep = -1; // End of onboarding
    }

    // Only update the session if it's not the final step
    if (nextStep !== -1 && nextStep !== 4) {
      await sessionsCollection.updateOne(
        { sessionId },
        { 
          $set: { 
            currentStep: nextStep,
            businessInfo: businessInfo
          }
        }
      );
    }

    const allMessages = [
      { content: message, isBot: false },
      { content: botReply, isBot: true }
    ];

    res.json({ success: true, messages: allMessages });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ success: false, message: 'Failed to send message.' });
  }
});

app.post('/endSession', async (req, res) => {
  const { sessionId } = req.body;

  try {
    const db = mongoClient.db('onboarding');
    const sessionsCollection = db.collection('sessions');
    await sessionsCollection.deleteOne({ sessionId });

    res.json({ success: true, message: 'Session ended successfully!' });
  } catch (error) {
    console.error('Error ending session:', error);
    res.status(500).json({ success: false, message: 'Failed to end session.' });
  }
});

// New endpoint to trigger the email notifier
app.post('/triggerEmailNotifier', async (req, res) => {
  try {
    await monitorAndSendEmails();
    res.json({ success: true, message: 'Email notifier triggered successfully!' });
  } catch (error) {
    console.error('Error triggering email notifier:', error);
    res.status(500).json({ success: false, message: 'Failed to trigger email notifier.' });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

process.on('SIGINT', async () => {
  await mongoClient.close();
  process.exit();
});

function validateEmailSyntax(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

async function triggerLambdaFunction(businessInfo) {
  const payload = {
    business_name: businessInfo.name,
    website_link: businessInfo.website,
    email: businessInfo.email
  };

  const params = new InvokeCommand({
    FunctionName: process.env.LAMBDA_FUNCTION_ARN,
    InvocationType: 'Event', 
    Payload: JSON.stringify(payload)
  });

  try {
    const result = await lambdaClient.send(params);
    console.log('Lambda function triggered successfully:', result);
  } catch (error) {
    console.error('Error triggering Lambda function:', error);
  }
}