const express = require('express');
const session = require('express-session');
const cors = require('cors');
const { MongoClient } = require('mongodb');
const { OAuth2Client } = require('google-auth-library');
const { GoogleAdsApi } = require('google-ads-api');
const axios = require('axios');
const fileUpload = require('express-fileupload');
const sharp = require('sharp');
const path = require('path');

const Redis = require('ioredis');
const RedisStore = require('connect-redis').default;

require('dotenv').config();


const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
const { monitorAndSendEmails } = require('./emailNotifier'); 
const admin = require('firebase-admin');

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    // The private key will be a JSON string in the .env file, so we need to parse it
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  }),
  databaseURL: process.env.FIREBASE_DATABASE_URL 
});

const oauth2Client = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  `${process.env.API_URL || 'http://localhost:3001'}/oauth2callback`
);

const redisClient = new Redis({
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT,
  password: process.env.REDIS_PASSWORD, 
});

redisClient.on('error', (err) => console.log('Redis Client Error', err));
redisClient.on('connect', () => console.log('Connected to Redis'));

const db = admin.database();

const app = express();
const port = process.env.PORT || 3001;

app.use(cors({
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173', 'https://www.adalchemyai.com'], // Add your frontend URL
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(fileUpload());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use(
  session({
    store: new RedisStore({ client: redisClient }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { 
      secure: process.env.NODE_ENV === 'production',
      maxAge: 24 * 60 * 60 * 1000,
      httpOnly: true
    },
    rolling: true
  })
);

const mongoClient = new MongoClient(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const lambdaClient = new LambdaClient({ region: process.env.AWS_REGION });

async function connectToMongo(maxRetries = 5, delay = 5000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await mongoClient.connect();
      console.log('Connected to MongoDB');
      return;
    } catch (err) {
      console.error(`Attempt ${i + 1} failed. Retrying in ${delay / 1000} seconds...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw new Error('Failed to connect to MongoDB after multiple attempts');
}

async function getMongoClient() {
  if (!mongoClient.topology || !mongoClient.topology.isConnected()) {
    await connectToMongo();
  }
  return mongoClient;
}

async function startServer() {
  try {
    await connectToMongo();
    const server = app.listen(port, () => {
      console.log(`Server running on port ${port}`);
    });

    server.on('error', (e) => {
      if (e.code === 'EADDRINUSE') {
        console.error('Address in use, please choose another port.');
        process.exit(1);
      } else {
        console.error('Server error:', e);
        process.exit(1);
      }
    });

  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

process.on('SIGINT', async () => {
  console.log('Shutting down gracefully');
  await mongoClient.close();
  process.exit();
});

// Call startServer at the end of your file
startServer();

const botResponses = [
  "Hello! I am AdAlchemyAI, a bot to help you get good leads for a cost-effective price for your business by automating the process of setting up, running, and optimizing your Google Ads. I only run ads after you manually approve the keywords I researched, the ad text ideas I generate, and the information I use to carry out my research. But for now, I would like to learn more about you and your business.",
  "What is the name of your business?"
];

// Add a new endpoint to check for analysis results
app.get('/checkAnalysisStatus', async (req, res) => {
  console.log('Checking analysis status');

  try {
    await mongoClient.connect();
    console.log('Connected to MongoDB successfully');
    const onboardingDb = mongoClient.db('onboarding');
    const sessionsCollection = onboardingDb.collection('sessions');
    const marketingDb = mongoClient.db('marketing_agent');

    // Fetch the session and check for progress
    const session = await sessionsCollection.findOne({
      emailSent: { $ne: true },
      lambdaTriggered: true
    });

    if (session) {
      const businessName = session.businessInfo.name;
      const marketingData = await marketingDb.collection(businessName).findOne();

      if (marketingData) {
        // Analysis complete, send data
        console.log('Analysis complete. Sending data...');
        res.json({
          type: 'analysisComplete',
          businessName: businessName,
          marketingData: marketingData
        });

        // Update session after sending data
        await sessionsCollection.updateOne(
          { _id: session._id },
          { $set: { emailSent: true } }
        );
      } else {
        // Analysis still in progress
        console.log('Analysis still in progress');
        res.json({ type: 'analysisInProgress', message: 'Analysis is still in progress' });
      }
    } else {
      console.log('No active analysis found');
      res.json({ type: 'noActiveAnalysis', message: 'No active analysis found' });
    }
  } catch (error) {
    console.error('Error checking for updates:', error);
    res.status(500).json({ type: 'error', message: 'Error checking for updates' });
  } finally {
    await mongoClient.close();
  }
});

app.get('/initiate-google-ads-oauth', (req, res) => {
  const { businessName } = req.query;
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/adwords'],
    state: businessName,
    redirect_uri: `${process.env.API_URL || 'http://localhost:3001'}/oauth2callback`
  });
  res.json({ authUrl });
});

app.post('/create-checkout-session', async (req, res) => {
  const { amount, isExistingCampaign } = req.body;
  console.log('API_URL:', process.env.API_URL);

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Ad Creation Fee',
            },
            unit_amount: Math.round(amount * 100), // Stripe expects amount in cents
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: isExistingCampaign 
      ? 'http://localhost:5173?payment_success_existing=true'
      : 'http://localhost:5173?payment_success=true',
      cancel_url: 'http://localhost:5173?payment_cancelled=true',
    });

    res.json({ id: session.id });
  } catch (error) {
    console.error('Error creating checkout session:', error);
    res.status(500).json({ error: error.message });
  }
});


app.post('/startSession', async (req, res) => {
  try {
    const sessionId = Math.random().toString(36).substring(7);
    const sessionData = {
      createdAt: new Date(),
      currentStep: 0,
      businessInfo: {},
      sidebarContent: 'test',
      isSidebarOpen: true
    };

    await redisClient.set(`session:${sessionId}`, JSON.stringify(sessionData));

    res.json({ 
      success: true, 
      sessionId, 
      initialMessages: botResponses,
      sessionData
    });
  } catch (error) {
    console.error('Error starting session:', error);
    res.status(500).json({ success: false, message: `Failed to start session: ${error.message}` });
  }
});

app.post('/api/analysisResults', async (req, res) => {
  const { businessName } = req.body;
  
  if (!businessName) {
    return res.status(400).json({ error: 'Business name is required' });
  }

  try {
    const client = await getMongoClient();
    const marketingDb = client.db('marketing_agent');
    
    const marketingData = await marketingDb.collection(businessName).findOne();
    // const judgeData = await judgeDataCollection.collection(businessName).findOne();

    if (marketingData) {
      res.json({
        businessName,
        marketingData,
        // judgeData
      });
    } else {
      res.status(404).json({ error: 'Analysis results not found' });
    }
  } catch (error) {
    console.error('Error fetching analysis results:', error);
    res.status(500).json({ error: 'Failed to fetch analysis results' });
  }
});

function validateCredentials(credentials) {
  const requiredFields = [
    'client_id',
    'client_secret',
    'developer_token',
    'refresh_token',
    'customer_id'
  ];

  return requiredFields.filter(field => !credentials[field]);
}

app.post('/getLogoAssets', async (req, res) => {
  const { businessName, campaignName } = req.body;

  try {
    const client = await getMongoClient();
    const db = client.db('credentials');
    const credentialsCollection = db.collection(businessName);
    const credentialsDoc = await credentialsCollection.findOne({});

    if (!credentialsDoc || !credentialsDoc.credentials) {
      return res.status(400).json({ success: false, message: 'Credentials not found.' });
    }
    const credentials = credentialsDoc.credentials;
    console.log('****', campaignName)

    const requestBody = {
      customer_id: credentials.customer_id,
      campaign_name: campaignName || 'Default Campaign Name',
      credentials: {
        refresh_token: credentials.refresh_token,
        token_uri: 'https://oauth2.googleapis.com/token',
        client_id: credentials.client_id,
        client_secret: credentials.client_secret,
        developer_token: credentials.developer_token,
        scopes: [
          'https://www.googleapis.com/auth/adwords',
          'https://www.googleapis.com/auth/adwords.readonly'
        ],
        universe_domain: credentials.universe_domain || 'googleapis.com', 
        account: credentials.account || credentials.client_email, 
        expiry: credentials.expiry || new Date().toISOString(),
        account: credentials.account || credentials.client_email || credentials.customer_id

      }
    };

    const response = await axios.post('https://googleadsapicalls.onrender.com/get_logo_assets', requestBody);
    console.log('***', response)

    if (response.data && response.data.assets) {
      res.json({ success: true, assets: response.data.assets });
    } else {
      throw new Error('Unexpected response format from logo assets API');
    }
  } catch (error) {
    console.error('Error fetching logo assets:', error);
    if (error.response) {
      console.error('Error response data:', JSON.stringify(error.response.data, null, 2));
    }  
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch logo assets.', 
      error: error.response ? error.response.data : error.message 
    });
  }
});

app.post('/authenticate', async (req, res) => {
  const { businessName } = req.body;
  console.log('businessName authenticate', businessName)

  try {
    const client = await getMongoClient();
    const db = client.db('credentials');
    const credentialsCollection = db.collection(businessName);
    const credentialsDoc = await credentialsCollection.findOne({});
    if (!credentialsDoc || !credentialsDoc.credentials) {
      return res.status(400).json({ success: false, message: 'Credentials not found. Please upload your Google Ads API credentials.' });
    }

    const credentials = credentialsDoc.credentials;
    const structuredCredentials = {
      web: {
        developer_token: credentials.developer_token,
        client_id: credentials.client_id,
        project_id: credentials.project_id,
        auth_uri: credentials.auth_uri,
        token_uri: credentials.token_uri,
        auth_provider_x509_cert_url: credentials.auth_provider_x509_cert_url,
        client_secret: credentials.client_secret,
        use_proto_plus: credentials.use_proto_plus,
        customer_id: credentials.customer_id,
        refresh_token: credentials.refresh_token
      }
    };

    const response = await axios.post('https://googleadsapicalls.onrender.com/authenticate', {
      customer_id: credentials.customer_id,
      credentials: structuredCredentials
    });

    const responseData = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;

    if (responseData.refresh_token) {
      await credentialsCollection.updateOne(
        {},
        { $set: { 'credentials.refresh_token': responseData.refresh_token } }
      );

      console.log('SUCCESS')
      return res.json({ success: true, message: 'Authentication successful.' });
    } else if (responseData.auth_url) {
      return res.json({ success: true, authUrl: responseData.auth_url, message: 'Please authorize access to your Google Ads account.' });
    } else {
      throw new Error('Unexpected response from authentication service.');
    }
  } catch (error) {
    console.error('Error in authentication:', error);
    res.status(500).json({ success: false, message: 'Failed to authenticate.' });
  }
});

app.post('/getCampaigns', async (req, res) => {

  const { businessName } = req.body;

  try {
    // Fetch credentials from the database

    const client = await getMongoClient();
    const db = client.db('credentials');
    const credentialsCollection = db.collection(businessName);
    const credentialsDoc = await credentialsCollection.findOne({});

    if (!credentialsDoc || !credentialsDoc.credentials) {
      return res.status(400).json({ success: false, message: 'Credentials not found. Please upload your Google Ads API credentials.' });
    }

    const credentials = credentialsDoc.credentials;

    // Prepare the request body for the external API
    const requestBody = {
      customer_id: credentials.customer_id,
      credentials: {
        refresh_token: credentials.refresh_token,
        token_uri: "https://oauth2.googleapis.com/token",
        client_id: credentials.client_id,
        client_secret: credentials.client_secret,
        developer_token: credentials.developer_token,
        scopes: [
          'https://www.googleapis.com/auth/adwords',
          'https://www.googleapis.com/auth/adwords.readonly'
        ]
      }
    };

    // Make a request to the external API
    const response = await axios.post('https://googleadsapicalls.onrender.com/get_campaigns', requestBody);

    const campaigns = response.data;
    console.log('Fetched campaigns:', JSON.stringify(campaigns, null, 2));

    res.json({ success: true, campaigns: campaigns });
  } catch (error) {
    console.error('Error fetching campaigns:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch campaigns.', error: error.message });
  }
});

app.post('/initAdCreation', async (req, res) => {
  const { businessName } = req.body;
  console.log('biz name', req.body)

  try {
    if (!businessName) {
      return res.status(400).json({ success: false, message: 'No business name provided' });
    }
    const client = await getMongoClient();
    const db = client.db('credentials');
    const credentialsCollection = db.collection(businessName);
    const credentials = await credentialsCollection.findOne({});
    
    if (!credentials) {
      console.log('here')
      return res.json({ success: true, requiresCredentials: true, message: 'Google Ads credentials not found. Please upload your credentials.' });
    }

    if (!credentials.credentials.refresh_token) {
      return res.json({ success: true, requiresAuth: true, message: 'Authentication required. Please complete the OAuth process.' });
    }
    res.json({ success: true, message: 'Credentials found. Ready to authenticate.' });
  } catch (error) {
    console.error('Error initiating ad creation:', error);
    res.status(500).json({ success: false, message: 'Failed to initiate ad creation. Please try again later.' });
  }
});

app.post('/createCampaign', async (req, res) => {
  const { businessName, campaignName, dailyBudget, startDate, endDate } = req.body;
  console.log('createCampaign', req.body)

  try {
    // Fetch credentials from MongoDB

    const client = await getMongoClient();
    const db = client.db('credentials');
    const credentialsCollection = db.collection(businessName);
    const credentialsDoc = await credentialsCollection.findOne({});

    if (!credentialsDoc || !credentialsDoc.credentials) {
      return res.status(400).json({ success: false, message: 'Credentials not found.' });
    }

    const credentials = credentialsDoc.credentials;

    // Prepare the data for the external API
    const payload = {
      credentials: {
        client_id: credentials.client_id,
        client_secret: credentials.client_secret,
        developer_token: credentials.developer_token,
        refresh_token: credentials.refresh_token,
        use_proto_plus: true,
        scopes: [
          'https://www.googleapis.com/auth/adwords',
          'https://www.googleapis.com/auth/adwords.readonly'
        ]
      },
      customer_id: credentials.customer_id.replace(/-/g, ''), 
      campaign_name: campaignName,
      daily_budget: parseFloat(dailyBudget),
      start_date: new Date(startDate),
      end_date: new Date(endDate)
    };

    // Make a request to the external API
    const response = await axios.post('https://googleadsapicalls.onrender.com/create_campaign', payload);

    if (response.data && response.data.campaign_id) {
      res.json({ 
        success: true, 
        message: 'Campaign created successfully', 
        campaignId: response.data.campaign_id 
      });
    } else {
      throw new Error('Unexpected response from campaign creation API');
    }
  } catch (error) {
    console.error('Error creating campaign:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to create campaign.', 
      error: error.response ? error.response.data : error.message 
    });
  }
});

app.post('/createAd', async (req, res) => {
  const { sessionId, adData, campaignId } = req.body;

  try {
    if (!global.sessions[sessionId]) {
      return res.status(404).json({ success: false, message: 'Session not found. Please start a new session.' });
    }

    const credentials = global.sessions[sessionId].credentials;
    const customer_id = credentials.customer_id;

    const client = new GoogleAdsApi({
      client_id: credentials.client_id,
      client_secret: credentials.client_secret,
      developer_token: credentials.developer_token
    });

    const customer = client.Customer({
      customer_id: customer_id,
      refresh_token: global.sessions[sessionId].tokens.refresh_token
    });

    // Create an ad group first
    const adGroup = await customer.adGroups.create({
      campaign_id: campaignId,
      name: `Ad Group for ${adData.headline}`,
      status: 'ENABLED'
    });

    // Create the responsive search ad
    const newAd = await customer.ads.create({
      ad_group_id: adGroup.id,
      type: 'RESPONSIVE_SEARCH_AD',
      responsive_search_ad: {
        headlines: [
          { text: adData.headline },
          { text: adData.headline2 || adData.headline },
          { text: adData.headline3 || adData.headline }
        ],
        descriptions: [
          { text: adData.description },
          { text: adData.description2 || adData.description }
        ],
        path1: adData.path1,
        path2: adData.path2,
        final_urls: [adData.finalUrl]
      }
    });

    res.json({ success: true, ad: newAd, adGroup: adGroup });
  } catch (error) {
    console.error('Error creating ad:', error);
    res.status(500).json({ success: false, message: 'Failed to create ad.' });
  }
});

// OAuth callback endpoint
app.get('/oauth2callback', async (req, res) => {
  const { code, state } = req.query;
  const businessName = state;
  console.log('Received callback with code:', code);

  try {
    if (!code) {
      throw new Error('No code received in callback');
    }

    const { tokens } = await oauth2Client.getToken(code);
    console.log('Received tokens:', tokens);

    // Store tokens in the session
    req.session.tokens = tokens;
    req.session.businessName = businessName;
    await new Promise((resolve, reject) => {
      req.session.save((err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    console.log('Tokens saved to session:', req.session.tokens);
    console.log('Session ID:', req.sessionID);
    console.log('Session token returned:', req.session.tokens);

    res.send(`
      <script>
        window.opener.postMessage({ 
          type: 'OAUTH_CALLBACK', 
          success: true, 
          sessionId: '${req.sessionID}',
          businessName: '${businessName}',
          tokens: '${JSON.stringify(req.session.tokens)}'
        }, '*');
        window.close();
      </script>
    `);
  } catch (error) {
    console.error('Error in OAuth callback:', error);
    res.status(500).send(`
      <script>
        window.opener.postMessage({ type: 'OAUTH_CALLBACK', success: false, error: '${error.message}' }, '*');
        window.close();
      </script>
    `);
  }
});

app.post('/auth/google', async (req, res) => {
  const { idToken } = req.body;
  
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const uid = decodedToken.uid;
    const email = decodedToken.email;

    // Check if a session exists with this email
    
    const client = await getMongoClient();
    const db = client.db('onboarding');
    const sessionsCollection = db.collection('sessions');
    const session = await sessionsCollection.findOne({ 'businessInfo.email': email });

    if (!session) {
      // User hasn't completed onboarding
      try {
        // Attempt to delete the user from Firebase Authentication
        try {
          await admin.auth().deleteUser(uid);
          console.log(`User ${uid} deleted from Firebase Authentication`);
        } catch (firebaseError) {
          if (firebaseError.code !== 'auth/user-not-found') {
            console.error('Error deleting user from Firebase:', firebaseError);
          }
          // If the user doesn't exist in Firebase, we can ignore this error
        }

        // Delete the user's entry from MongoDB if it exists
        const usersCollection = db.collection('users');
        await usersCollection.deleteOne({ uid: uid });

        console.log(`User ${uid} processed due to incomplete onboarding`);

        return res.json({ 
          success: false, 
          message: 'Please complete the onboarding process before logging in.',
          requiresOnboarding: true,
          userDeleted: true
        });
      } catch (deleteError) {
        console.error('Error processing user:', deleteError);
        return res.status(500).json({ 
          success: false, 
          message: 'An error occurred during authentication. Please try again.',
          requiresOnboarding: true
        });
      }
    }

    // If session exists, continue with the existing logic
    const businessName = session.businessInfo.name;
    const businessDescription = session.businessInfo.business_context;

    // Update or create user data in MongoDB
    const usersCollection = db.collection('users');
    await usersCollection.updateOne(
      { uid: uid },
      { $set: { email, businessName } },
      { upsert: true }
    );

    res.json({ 
      success: true, 
      uid, 
      businessName,
      businessDescription,
      message: 'Authentication successful'
    });
  } catch (error) {
    console.error('Error verifying Google Sign-In token:', error);
    res.status(401).json({ success: false, message: 'Unauthorized' });
  }
});

async function checkCredentials(sessionId, res) {
  try {
    const client = await getMongoClient();
    const db = client.db('credentials');
    const credentialsCollection = db.collection(global.sessions[sessionId].businessInfo.name);
    
    const credentials = await credentialsCollection.findOne({});

    if (!credentials) {
      // No credentials found, prompt user to upload
      return res.json({ success: true, message: 'Please upload your Google Ads API credentials.', requiresCredentials: true });
    }

    // Credentials exist, proceed to next step
    res.json({ success: true, message: 'Credentials found. Proceeding to conversion funnel setup.' });
  } catch (error) {
    console.error('Error checking credentials:', error);
    res.status(500).json({ success: false, message: 'Failed to check credentials.' });
  }
}

app.post('/auth/check-onboarding', async (req, res) => {
  const { idToken } = req.body;
  
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const email = decodedToken.email;

    const client = await getMongoClient();
    const db = client.db('onboarding');
    const sessionsCollection = db.collection('sessions');
    const session = await sessionsCollection.findOne({ 'businessInfo.email': email });

    res.json({ 
      hasCompletedOnboarding: !!session,
    });
  } catch (error) {
    console.error('Error checking onboarding status:', error);
    res.status(401).json({ success: false, message: 'Unauthorized' });
  }
});

app.post('/getBusinessDescription', async (req, res) => {
  const { businessName } = req.body;

  try {
    const client = await getMongoClient();
    const marketingDb = client.db('marketing_agent');
    const businessCollection = marketingDb.collection(businessName);
    
    const businessData = await businessCollection.findOne({});
    
    if (businessData && businessData.business) {
      res.json({ businessDescription: businessData.business });
    } else {
      res.json({ businessDescription: null });
    }
  } catch (error) {
    console.error('Error fetching business description:', error);
    res.status(500).json({ error: 'Failed to fetch business description' });
  }
});

app.post('/createAd', async (req, res) => {
  const { sessionId } = req.body;

  try {
    // Verify session exists
    if (!global.sessions[sessionId]) {
      return res.status(404).json({ success: false, message: 'Session not found. Please start a new session.' });
    }

    // Proceed to check credentials
    await checkCredentials(sessionId, res);
  } catch (error) {
    console.error('Error initiating ad creation:', error);
    res.status(500).json({ success: false, message: 'Failed to initiate ad creation.' });
  }
});


app.post('/upload_logo', async (req, res) => {
  const { business_name, campaignName } = req.body;
  console.log('req', req.body)

  if (!req.files || !req.files.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const file = req.files.file;

  try {
    let mongoClient = await getMongoClient();
    const db = mongoClient.db('credentials');
    const credentialsCollection = db.collection(business_name);
    const credentialsDoc = await credentialsCollection.findOne({});

    if (!credentialsDoc || !credentialsDoc.credentials) {
      return res
        .status(400)
        .json({ success: false, message: 'Credentials not found.' });
    }

    const credentials = credentialsDoc.credentials;

    const customerId = credentials.customer_id.replace(/-/g, '');


    // Initialize the Google Ads API client
    const client = new GoogleAdsApi({
      client_id: credentials.client_id,
      client_secret: credentials.client_secret,
      developer_token: credentials.developer_token,
    });

    const customer = client.Customer({
      customer_id: customerId,
      refresh_token: credentials.refresh_token,
    });

    // Read the image data and encode it in base64
    const imageData = file.data.toString('base64');

    // Get image dimensions using sharp
    const image = sharp(file.data);
    const metadata = await image.metadata();

    // Save the image to the server
    const uploadPath = path.join(__dirname, 'uploads', file.name);
    await image.toFile(uploadPath);

    // Generate the URL for the uploaded image
    const imageUrl = `${req.protocol}://${req.get('host')}/uploads/${file.name}`;

    // Create the image asset
    const asset = {
      name: 'Logo Asset',
      type: 'IMAGE',
      image_asset: {
        data: imageData,
        file_size: file.size,
        mime_type: 'IMAGE_JPEG', 
        full_size: {
          height_pixels: metadata.height,
          width_pixels: metadata.width,
          url: imageUrl
        }
      }
    };

    // Ensure the asset is wrapped in an array
    const response = await customer.assets.create([asset]);

    if (!response || !response.results || response.results.length === 0 || !response.results[0].resource_name) {
      throw new Error('Unexpected response format from Google Ads API');
    }

    // Extract the asset ID from the resource_name
    const resourceName = response.results[0].resource_name;
    const assetId = resourceName.split('/').pop();

    res.json({
      success: true,
      message: 'Logo uploaded successfully',
      asset_id: assetId,
      resource_name: resourceName,
    });

  } catch (error) {
    console.error('Error uploading logo:', error);
    console.error(error.stack);
    res.status(500).json({
      success: false,
      message: 'Failed to upload logo.',
      error: error.message,
    });
  }
});

app.post('/fetch_asset_details', async (req, res) => {
  const { business_name, resource_name } = req.body;

  try {
    // Fetch credentials from MongoDB

    const mongoClient = await getMongoClient();
    const db = mongoClient.db('credentials');
    const credentialsCollection = db.collection(business_name);
    const credentialsDoc = await credentialsCollection.findOne({});

    if (!credentialsDoc || !credentialsDoc.credentials) {
      return res.status(400).json({ success: false, message: 'Credentials not found.' });
    }

    const credentials = credentialsDoc.credentials;

    // Ensure the customer ID is correctly formatted (without dashes)
    const customerId = credentials.customer_id.replace(/-/g, '');
    console.log('Formatted Customer ID:', customerId);

    // Initialize the Google Ads API client
    const client = new GoogleAdsApi({
      client_id: credentials.client_id,
      client_secret: credentials.client_secret,
      developer_token: credentials.developer_token,
    });

    const customer = client.Customer({
      customer_id: customerId,
      refresh_token: credentials.refresh_token,
    });

    // Fetch asset details
    const query = `
      SELECT
        asset.resource_name,
        asset.id,
        asset.name,
        asset.type,
        asset.image_asset.file_size,
        asset.image_asset.full_size.url
      FROM
        asset
      WHERE
        asset.resource_name = '${resource_name}'
    `;
    const assetDetails = await customer.query(query);

    // Log the asset details for debugging
    console.log('Asset Details:', assetDetails);

    res.json({
      success: true,
      asset: assetDetails[0],
    });
  } catch (error) {
    console.error('Error fetching asset details:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch asset details.',
      error: error.message,
    });
  }
});

app.post('/list_assets', async (req, res) => {
  const { business_name } = req.body;

  try {
    // Fetch credentials from MongoDB
    const mongoClient = await getMongoClient();
    const db = mongoClient.db('credentials');
    const credentialsCollection = db.collection(business_name);
    const credentialsDoc = await credentialsCollection.findOne({});

    if (!credentialsDoc || !credentialsDoc.credentials) {
      return res.status(400).json({ success: false, message: 'Credentials not found.' });
    }

    const credentials = credentialsDoc.credentials;

    // Ensure the customer ID is correctly formatted (without dashes)
    const customerId = credentials.customer_id.replace(/-/g, '');
    console.log('Formatted Customer ID:', customerId);

    // Initialize the Google Ads API client
    const client = new GoogleAdsApi({
      client_id: credentials.client_id,
      client_secret: credentials.client_secret,
      developer_token: credentials.developer_token,
    });

    const customer = client.Customer({
      customer_id: customerId,
      refresh_token: credentials.refresh_token,
    });

    // Fetch all assets
    const query = `
      SELECT
        asset.resource_name,
        asset.id,
        asset.name,
        asset.type,
        asset.image_asset.file_size,
        asset.image_asset.full_size.url
      FROM
        asset
    `;
    const assets = await customer.query(query);
    const filteredAssets = assets.filter(asset => asset.asset.image_asset !== null);

    res.json({
      success: true,
      assets: filteredAssets,
    });
  } catch (error) {
    console.error('Error listing assets:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to list assets.',
      error: error.message,
    });
  }
});


app.post('/uploadCredentials', async (req, res) => {
  const { sessionId, credentials } = req.body;

  try {
    if (!global.sessions[sessionId]) {
      return res.status(404).json({ success: false, message: 'Session not found. Please start a new session.' });
    }

    // Validate credentials
    if (!validateCredentials(credentials)) {
      return res.status(400).json({ success: false, message: 'Invalid credentials format.' });
    }

    // Store credentials in MongoDB
    const client = await getMongoClient();
    const db = client.db('credentials');
    const credentialsCollection = db.collection(global.sessions[sessionId].businessInfo.name);
    
    await credentialsCollection.updateOne({}, { $set: credentials }, { upsert: true });

    res.json({ success: true, message: 'Credentials uploaded successfully.' });
  } catch (error) {
    console.error('Error uploading credentials:', error);
    res.status(500).json({ success: false, message: 'Failed to upload credentials.' });
  }
});

function validateCredentials(credentials) {
  // Required fields for Google Ads API credentials
  const requiredFields = [
    'client_id',
    'project_id',
    'auth_uri',
    'token_uri',
    'auth_provider_x509_cert_url',
    'client_secret',
    'redirect_uris'
  ];

  // Optional fields that should be validated if present
  const optionalFields = [
    'developer_token',
    'use_proto_plus'
  ];

  // Check if all required fields are present and not empty
  for (const field of requiredFields) {
    if (!credentials.hasOwnProperty(field) || !credentials[field]) {
      console.error(`Missing or empty required field: ${field}`);
      return false;
    }
  }

  // Validate specific fields
  if (!Array.isArray(credentials.redirect_uris) || credentials.redirect_uris.length === 0) {
    console.error('redirect_uris must be a non-empty array');
    return false;
  }

  if (!credentials.redirect_uris.every(uri => uri.startsWith('http://') || uri.startsWith('https://'))) {
    console.error('All redirect URIs must start with http:// or https://');
    return false;
  }

  if (!credentials.auth_uri.startsWith('https://')) {
    console.error('auth_uri must start with https://');
    return false;
  }

  if (!credentials.token_uri.startsWith('https://')) {
    console.error('token_uri must start with https://');
    return false;
  }

  // Validate optional fields if present
  if (credentials.hasOwnProperty('developer_token') && typeof credentials.developer_token !== 'string') {
    console.error('developer_token must be a string');
    return false;
  }

  if (credentials.hasOwnProperty('use_proto_plus') && typeof credentials.use_proto_plus !== 'boolean') {
    console.error('use_proto_plus must be a boolean');
    return false;
  }

  return true;
}

app.post('/setupConversionFunnel', async (req, res) => {
  const { sessionId, setupFunnel } = req.body;

  try {
    if (!global.sessions[sessionId]) {
      return res.status(404).json({ success: false, message: 'Session not found. Please start a new session.' });
    }

    if (setupFunnel) {
      // User wants to set up a conversion funnel
      global.sessions[sessionId].setupFunnel = true;
      res.json({ success: true, message: 'Proceeding with conversion funnel setup.', nextStep: 'formTypeSelection' });
    } else {
      // User doesn't want to set up a conversion funnel
      global.sessions[sessionId].setupFunnel = false;
      res.json({ success: true, message: 'Skipping conversion funnel setup.', nextStep: 'campaignSelection' });
    }
  } catch (error) {
    console.error('Error in conversion funnel setup:', error);
    res.status(500).json({ success: false, message: 'Failed to process conversion funnel setup.' });
  }
});

app.post('/selectFormType', async (req, res) => {
  const { sessionId, formType } = req.body;

  try {
    if (!global.sessions[sessionId]) {
      return res.status(404).json({ success: false, message: 'Session not found. Please start a new session.' });
    }

    if (formType !== 'tally') {
      return res.status(400).json({ success: false, message: 'Invalid form type. Currently, only Tally forms are supported.' });
    }

    global.sessions[sessionId].formType = formType;
    res.json({ success: true, message: 'Form type selected successfully.', nextStep: 'campaignSelection' });
  } catch (error) {
    console.error('Error in form type selection:', error);
    res.status(500).json({ success: false, message: 'Failed to process form type selection.' });
  }
});

app.post('/selectCampaignOption', async (req, res) => {
  const { sessionId, option } = req.body;

  try {
    if (!global.sessions[sessionId]) {
      return res.status(404).json({ success: false, message: 'Session not found. Please start a new session.' });
    }

    if (option !== 'existing' && option !== 'new') {
      return res.status(400).json({ success: false, message: 'Invalid campaign option. Please choose "existing" or "new".' });
    }

    global.sessions[sessionId].campaignOption = option;

    // Proceed to authentication
    res.json({ success: true, message: 'Campaign option selected. Proceeding to authentication.', nextStep: 'authenticate' });
  } catch (error) {
    console.error('Error in campaign option selection:', error);
    res.status(500).json({ success: false, message: 'Failed to process campaign option selection.' });
  }
});

// Token exchange endpoint
app.post('/exchangeGoogleAdsCode', async (req, res) => {
  const { businessName, tokens } = req.body;
  console.log('tokens*******!!!', tokens)

  try {
    if (!tokens) {
      throw new Error('No tokens found in session');
    }

    // Ensure we have a MongoDB connection
    const client = await getMongoClient();
    const db = client.db('credentials');
    const credentialsCollection = db.collection(businessName);

    const tokenObject = typeof tokens === 'string' ? JSON.parse(tokens) : tokens;


    // Store tokens in MongoDB
    await credentialsCollection.updateOne(
      {},
      { 
        $set: { 
          credentials: tokenObject
        } 
      },
      { upsert: true }
    );

    console.log('Tokens stored successfully for business:', businessName);

    // Clear the tokens from the session
    delete req.session.tokens;
    await new Promise((resolve, reject) => {
      req.session.save((err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    res.json({ success: true, message: 'Google Ads authentication successful' });
  } catch (error) {
    console.error('Error in exchangeGoogleAdsCode:', error);
    res.status(500).json({ success: false, message: 'Failed to authenticate with Google Ads', error: error.message });
  }
});

app.post('/updateCustomerId', async (req, res) => {
  const { businessName, customerId } = req.body;

  try {
    const client = await getMongoClient();
    const db = client.db('credentials');
    const credentialsCollection = db.collection(businessName);

    await credentialsCollection.updateOne(
      {},
      { 
        $set: { 
          'credentials.customer_id': customerId,
          'credentials.client_id': process.env.GOOGLE_CLIENT_ID,
          'credentials.client_secret': process.env.GOOGLE_CLIENT_SECRET,
          'credentials.developer_token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN
        } 
      }
    );

    res.json({ success: true, message: 'Customer ID and additional credentials updated successfully' });
  } catch (error) {
    console.error('Error updating customer ID and additional credentials:', error);
    res.status(500).json({ success: false, message: 'Failed to update customer ID and additional credentials' });
  }
});


app.post('/updateCustomerId', async (req, res) => {
  const { businessName, customerId } = req.body;

  try {
    const client = await getMongoClient();
    const db = client.db('credentials');
    const credentialsCollection = db.collection(businessName);

    const result = await credentialsCollection.updateOne(
      {},
      { 
        $set: { 
          'credentials.customer_id': customerId
        } 
      }
    );

    if (result.modifiedCount === 1) {
      res.json({ success: true, message: 'Customer ID updated successfully' });
    } else {
      res.status(404).json({ success: false, message: 'No credentials found to update' });
    }
  } catch (error) {
    console.error('Error updating customer ID:', error);
    res.status(500).json({ success: false, message: 'Failed to update customer ID' });
  }
});

// Endpoint to submit ad variation
app.post('/submitAdVariation', async (req, res) => {
  const { business, variationIndex, changedHeadlines, changedDescriptions } = req.body;
  const businessName = business

  try {
    const client = await getMongoClient();
    const db = client.db('marketing_agent');
    const collection = db.collection(businessName);

    const doc = await collection.findOne({});
    if (!doc || !doc.list_of_ad_text) {
      return res.status(404).json({ success: false, message: 'Ad variations not found' });
    }

    const updateObject = {};

    changedHeadlines.forEach(({ index, text }) => {
      if (typeof doc.list_of_ad_text[variationIndex].headlines[index] === 'string') {
        updateObject[`list_of_ad_text.${variationIndex}.headlines.${index}`] = text;
      } else {
        updateObject[`list_of_ad_text.${variationIndex}.headlines.${index}.text`] = text;
      }
    });

    changedDescriptions.forEach(({ index, text }) => {
      if (typeof doc.list_of_ad_text[variationIndex].descriptions[index] === 'string') {
        updateObject[`list_of_ad_text.${variationIndex}.descriptions.${index}`] = text;
      } else {
        updateObject[`list_of_ad_text.${variationIndex}.descriptions.${index}.text`] = text;
      }
    });

    if (Object.keys(updateObject).length > 0) {
      await collection.updateOne({}, { $set: updateObject });
    }

    res.json({ success: true, message: 'Ad variation updated successfully' });
  } catch (error) {
    console.error('Error updating ad variation:', error);
    res.status(500).json({ success: false, message: 'Failed to update ad variation' });
  }
});

app.post('/submitKeywords', async (req, res) => {
  const { businessName, selectedKeywords } = req.body;

  try {
    const client = await getMongoClient();
    const db = client.db('marketing_agent');
    const collection = db.collection(businessName);

    await collection.updateOne(
      {},
      { 
        $set: { list_of_keywords: selectedKeywords },
        $currentDate: { last_update: true }
      }
    );

    res.json({ 
      success: true, 
      message: 'Keywords updated successfully',
      updatedKeywords: selectedKeywords
    });
  } catch (error) {
    console.error('Error updating keywords:', error);
    res.status(500).json({ success: false, message: 'Failed to update keywords' });
  }
});

app.post('/deleteResearchPath', async (req, res) => {
  const { businessName, pathIndex } = req.body;

  try {
    const client = await getMongoClient();
    const db = client.db('marketing_agent');
    const collection = db.collection(businessName);

    const result = await collection.findOne({});
    let paths = result.list_of_paths_taken || [];

    if (pathIndex < 0 || pathIndex >= paths.length) {
      return res.status(400).json({ success: false, message: 'Invalid path index' });
    }

    paths.splice(pathIndex, 1);

    await collection.updateOne(
      {},
      { $set: { list_of_paths_taken: paths } }
    );

    res.json({ 
      success: true, 
      message: 'Research path deleted successfully',
      updatedPaths: paths
    });
  } catch (error) {
    console.error('Error deleting research path:', error);
    res.status(500).json({ success: false, message: 'Failed to delete research path' });
  }
});

app.post('/addResearchPath', async (req, res) => {
  const { businessName, newPath } = req.body;

  try {
    const client = await getMongoClient();
    const db = client.db('marketing_agent');
    const collection = db.collection(businessName);

    const result = await collection.findOne({});
    let paths = result.list_of_paths_taken || [];

    paths.push(newPath);

    await collection.updateOne(
      {},
      { $set: { list_of_paths_taken: paths } }
    );

    res.json({ 
      success: true, 
      message: 'Research path added successfully',
      updatedPaths: paths
    });
  } catch (error) {
    console.error('Error adding research path:', error);
    res.status(500).json({ success: false, message: 'Failed to add research path' });
  }
});

app.get('/random-doodle', async (req, res) => {
  try {
    const response = await axios.get('https://www.google.com/doodles/json/2023/1');
    const doodles = response.data;
    const randomDoodle = doodles[Math.floor(Math.random() * doodles.length)];
    const doodleUrl = `${randomDoodle.url}`;
    res.json({ url: doodleUrl });
  } catch (error) {
    console.error('Error fetching Google Doodle:', error);
    res.status(500).json({ error: 'Failed to fetch Google Doodle' });
  }
});

app.post('/updateUserPersonas', async (req, res) => {
  const { businessName, userPersonas } = req.body;

  try {
    const client = await getMongoClient();
    const db = client.db('marketing_agent');
    const collection = db.collection(businessName);

    await collection.updateOne(
      {},
      { $set: { user_personas: userPersonas } },
      { upsert: true }
    );

    res.json({ success: true, message: 'User personas updated successfully' });
  } catch (error) {
    console.error('Error updating user personas:', error);
    res.status(500).json({ success: false, message: 'Failed to update user personas' });
  }
});

app.post('/deleteUserPersona', async (req, res) => {
  const { businessName, personaIndex } = req.body;

  try {
    const client = await getMongoClient();
    const db = client.db('marketing_agent');
    const collection = db.collection(businessName);
    const result = await collection.findOne({});
    let userPersonas = result.user_personas || [];

    userPersonas.splice(personaIndex, 1);
    await collection.updateOne(
      {},
      { $set: { user_personas: userPersonas } }
    );

    res.json({ 
      success: true, 
      message: 'User persona deleted successfully',
      updatedPersonas: userPersonas
    });
  } catch (error) {
    console.error('Error deleting user persona:', error);
    res.status(500).json({ success: false, message: 'Failed to delete user persona' });
  }
});

app.post('/finalizeAdVariation', async (req, res) => {
  const { businessName, type, index } = req.body;
  console.log('businessName', businessName)

  try {

    const client = await getMongoClient();
    const db = client.db('marketing_agent');
    const collection = db.collection(businessName);

    // Fetch the current document
    const doc = await collection.findOne({});
    if (!doc || !doc.list_of_ad_text) {
      return res.status(404).json({ success: false, message: 'Ad variations not found' });
    }

    // Update the specific item to mark it as finalized
    const field = type === 'headline' ? 'headlines' : 'descriptions';
    const item = doc.list_of_ad_text[field][index];
    
    if (typeof item === 'string') {
      // If the item is a string, convert it to an object
      doc.list_of_ad_text[field][index] = { text: item, finalized: true };
    } else if (typeof item === 'object') {
      // If it's already an object, just set the finalized property
      doc.list_of_ad_text[field][index].finalized = true;
    } else {
      return res.status(400).json({ success: false, message: 'Invalid ad variation format' });
    }

    // Update the document in the database
    await collection.updateOne({}, { $set: { list_of_ad_text: doc.list_of_ad_text } });

    res.json({ success: true, message: 'Ad variation finalized successfully' });
  } catch (error) {
    console.error('Error finalizing ad variation:', error);
    res.status(500).json({ success: false, message: 'Failed to finalize ad variation' });
  }
});

// Endpoint to delete ad variation
app.post('/deleteAdVariation', async (req, res) => {
  const { business, type, index } = req.body;

  try {
    const client = await getMongoClient();
    const db = client.db('marketing_agent');
    const collection = db.collection(business);

    const doc = await collection.findOne({});

    if (!doc || !doc.list_of_ad_text) {
      return res.status(404).json({ success: false, message: 'Ad variations not found' });
    }

    const adVariations = doc.list_of_ad_text;
    if (!adVariations[`${type}s`] || !Array.isArray(adVariations[`${type}s`])) {
      return res.status(400).json({ success: false, message: `Invalid ${type} array` });
    }

    adVariations[`${type}s`] = adVariations[`${type}s`].filter((_, i) => i !== index);

    await collection.updateOne({}, { $set: { list_of_ad_text: adVariations } });

    res.json({ success: true, message: 'Ad variation deleted successfully' });
  } catch (error) {
    console.error('Error deleting ad variation:', error);
    res.status(500).json({ success: false, message: 'Failed to delete ad variation' });
  }
});


app.post('/sendMessage', async (req, res) => {
  const { message, sessionId } = req.body;
  console.log('sessionID', sessionId)

  try {
    const client = await getMongoClient();
    const db = client.db('onboarding');
    const sessionsCollection = db.collection('sessions');
    
    const sessionData = await redisClient.get(`session:${sessionId}`);
    let session = sessionData ? JSON.parse(sessionData) : null;
    
    if (!session) {
      return res.status(404).json({ success: false, message: 'Session not found. Please start a new session.' });
    }

    let botReply = '';
    let currentStep = session.currentStep;
    let businessInfo = session.businessInfo || {};

    switch (currentStep) {
      case 0:
        // Check for duplicate business name (case insensitive)
        const duplicateBusinessName = await sessionsCollection.findOne({ 'businessInfo.name': { $regex: new RegExp(`^${message}$`, 'i') } });
        if (duplicateBusinessName) {
          return res.json({ success: false, message: 'The business name you provided already exists. If this is your business, you can log in.', showLogin: true });
        } else {
          businessInfo.name = message;
          botReply = `Please give me a link to your website ${message}:`;
          currentStep = 1;
          stepUpdated = true;
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
            currentStep = 1; // Stay on the same step
          } else if (response.status === 200 && !invalidKeywords.some(keyword => content.includes(keyword))) {
            businessInfo.website = message;
            botReply = "Please provide additional context about your business to help our AI Agents better understand your business. While we will be getting information from your site, more context will help us create more effective ads for you.";
            currentStep = 2;
            stepUpdated = true;
          } else {
            throw new Error('Website is not valid or is for sale');
          }
        } catch (error) {
          console.log('error****', error)
          botReply = "The website you provided is not reachable or is for sale. Please provide a valid website link.";
          currentStep = 1; // Stay on the same step
        }
        break;
      case 2:
        businessInfo.business_context = message;
        botReply = "Thank you for the additional information. Could you please provide your email address?";
        currentStep = 3;
        stepUpdated = true;
        await triggerLambdaFunction(businessInfo);
        break;
      case 3:
        if (validateEmailSyntax(message)) {
          // Check for duplicate email
          const duplicateEmail = await sessionsCollection.findOne({ 'businessInfo.email': message });
          if (duplicateEmail) {
            botReply = "The email address you provided already exists. Please provide a different email address.";
            currentStep = 3; 
          } else {
            businessInfo.email = message;
            botReply = `Thank you for your interest in our AI-powered ad creation service. Let me explain our pricing model:
            
              Our fees are based on a percentage of your ad budget, designed to be fair and scalable for businesses of all sizes:
              
              $1 - 100 = 10%
              $101 - $499 - 7.5%
              $500 + 5%
      
              This model ensures that our service remains accessible to small businesses while providing excellent value for larger campaigns.
              
              Would you like to proceed with our service? Please enter 'Y' for Yes or 'N' for No.`;
            currentStep = 4; 
            stepUpdated = true;
          }
        } else {
          botReply = "The email address format is not valid. Please provide a valid email address.";
          currentStep = 3; 
        }
        break;
      case 4:
        if (message.toLowerCase() === 'y') {
          console.log('updating session Data')
          sessionsCollection.insertOne({
            sessionId,
            businessInfo,
            createdAt: session.createdAt,
            currentStep: 5,
            emailSent: false,
            onboardingCompleted: false,
            analysisStarted: new Date(),
            lambdaTriggered: true
          });
          botReply = "Our Company Researcher agent will now start analyzing";
          currentStep = -1;
          stepUpdated = true;
        } else if (message.toLowerCase() === 'n') {
          botReply = "Thank you for your response. If you change your mind, feel free to start a new session.";
          currentStep = -1; 
          stepUpdated = true;
        } else {
          botReply = "I'm sorry, I didn't understand your response. Would you like to proceed with our service? Please enter 'Y' for Yes or 'N' for No.";
          // Stay on the same step
        }
        break;      
    }

    if (currentStep !== -1) {
      // Update session data in Redis
      console.log('updating session', currentStep)
      const updatedSession = {
        ...session,
        currentStep: currentStep,
        businessInfo
      };
      await redisClient.set(`session:${sessionId}`, JSON.stringify(updatedSession));
    }

    // Send the initial response with the calculation
    res.json({
      success: true,
      messages: [
        { content: message, isBot: false },
        { content: botReply, isBot: true }
      ],
      sessionData: {
        currentStep: currentStep,
        businessInfo
      }
    });

    // If we've reached step 5, start polling for marketing data
    if (currentStep === 5) {
      const client = await getMongoClient();
      const marketingDb = client.db('marketing_agent');
      let marketingData = null;

      // Poll for marketing data
      const pollInterval = setInterval(async () => {
        marketingData = await marketingDb.collection(businessInfo.name).findOne();
        
        if (marketingData) {
          clearInterval(pollInterval);
          
          // Send the marketing data when it becomes available
          res.write('data: ' + JSON.stringify({
            event: 'analysisComplete',
            analysisResults: {
              businessName: businessInfo.name,
              marketingData: marketingData,
            }
          }) + '\n\n');
          
          res.end(); // End the response after sending the marketing data
        }
      }, 5000); // Check every 5 seconds

      // Set a timeout to stop polling after a certain time (e.g., 5 minutes)
      setTimeout(() => {
        clearInterval(pollInterval);
        if (!marketingData) {
          res.write('data: ' + JSON.stringify({
            event: 'analysisTimeout',
            message: 'Analysis timed out. Please try again later.'
          }) + '\n\n');
          res.end();
        }
      }, 300000); // 5 minutes timeout
    }

  } catch (error) {
    console.error('Error sending message:', error);
    if (error.name === 'MongoNotConnectedError') {
      res.status(503).json({ success: false, message: 'Database connection error. Please try again in a few moments.' });
    } else {
      res.status(500).json({ success: false, message: 'Failed to send message. Please try again.' });
    }
  }
});

app.post('/updateSidebarState', async (req, res) => {
  const { sessionId, sidebarContent, isSidebarOpen } = req.body;

  try {
    const sessionData = await redisClient.get(`session:${sessionId}`);
    let session = sessionData ? JSON.parse(sessionData) : null;
    
    if (!session) {
      return res.status(404).json({ success: false, message: 'Session not found.' });
    }

    session.sidebarContent = sidebarContent;
    session.isSidebarOpen = isSidebarOpen;

    await redisClient.set(`session:${sessionId}`, JSON.stringify(session));

    res.json({ 
      success: true, 
      message: 'Sidebar state updated successfully',
      sessionData: session   
    });
  } catch (error) {
    console.error('Error updating sidebar state:', error);
    res.status(500).json({ success: false, message: 'Failed to update sidebar state.' });
  }
});

app.post('/proxy/ad-selector', async (req, res) => {
  try {
    const { business_name, number_of_ads } = req.body;
    
    const response = await axios.post(
      'https://emms21--ad-selector-agent-fetch-and-process.modal.run/',
      { business_name, number_of_ads },
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
    res.json(response.data);
  } catch (error) {
    console.error('Error proxying request to Modal API:', error);
    if (error.response) {
      console.error('Response data:', error.response.data);
      console.error('Response status:', error.response.status);
    }
    res.status(500).json({ success: false, message: 'Failed to create ads', error: error.message });
  }
});

app.post('/generateNewOutput', async (req, res) => {
  const { businessName } = req.body;

  try {
    const client = await getMongoClient();
    const db = client.db('marketing_agent');
    const collection = db.collection(businessName);

    const doc = await collection.findOne({});
    if (!doc) {
      return res.status(404).json({ success: false, message: 'Business data not found' });
    }

    const onboardingDb = client.db('onboarding');
    const sessionsCollection = onboardingDb.collection('sessions');
    const sessionDoc = await sessionsCollection.findOne({ 'businessInfo.name': businessName });

    if (!sessionDoc) {
      return res.status(404).json({ success: false, message: 'Onboarding data not found' });
    }

    // Get finalized headlines and descriptions
    const finalizedHeadlines = doc.list_of_ad_text.headlines
      .filter(h => h.finalized)
      .map(h => typeof h === 'string' ? h : h.text);

    const finalizedDescriptions = doc.list_of_ad_text.descriptions
      .filter(d => d.finalized)
      .map(d => typeof d === 'string' ? d : d.text);

    // Extract only keyword text from keywords array
    const keywordTexts = doc.list_of_keywords.map(k => k.keyword);

    // Prepare data for the AI agent
    const trainingData = {
      keywords: keywordTexts,
      headlines: finalizedHeadlines,
      descriptions: finalizedDescriptions,
      user_personas: doc.user_personas || [],
      list_of_paths_taken: doc.list_of_paths_taken || [],
      business_context: doc.business || '',
      business_name: sessionDoc.businessInfo.name,
      company_url: sessionDoc.businessInfo.website,
      action: "learn"
    };
    // console.log('trainingData', trainingData)

    // 2. Send to Modal endpoint
    const modalResponse = await fetch('https://emms21--marketing-agent-agent.modal.run', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(trainingData)
    });

    if (!modalResponse.ok) {
      throw new Error('Failed to process with Modal endpoint');
    }

    const result = await modalResponse.json();
    const currentDoc = await collection.findOne({});
    const updatedKeywords = processNewKeywords(currentDoc.list_of_keywords, result.list_of_keywords);
    const updatedAdText = processNewAdText(currentDoc.list_of_ad_text, result.list_of_ad_text);
    const currentDate = new Date();

    // Update the document in MongoDB
    await collection.updateOne({}, {
      $set: {
        list_of_keywords: updatedKeywords,
        list_of_ad_text: updatedAdText,
        date_written: {
          year: currentDate.getFullYear(),
          month: currentDate.getMonth() + 1,
          day: currentDate.getDate()
        }
      }
    });

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Error generating new output:', error);
    res.status(500).json({ success: false, message: 'Failed to generate new output' });
  }
});

// Helper function to process keywords
function processNewKeywords(existingKeywords, newKeywords) {
  // Remove 'new' label from existing keywords
  const updatedExisting = existingKeywords.map(keyword => ({
    ...keyword,
    new: undefined
  }));

  // Add 'new' label to new keywords
  const processedNew = newKeywords.map(keyword => ({
    ...keyword,
    new: true
  }));

  // Combine existing and new keywords
  // Filter out duplicates based on the keyword text
  const seen = new Set(updatedExisting.map(k => k.keyword));
  const uniqueNew = processedNew.filter(k => !seen.has(k.keyword));

  return [...updatedExisting, ...uniqueNew];
}

function processNewAdText(existingAdText, newAdText) {
  // Process headlines
  const updatedHeadlines = processAdTextArray(
    existingAdText.headlines,
    newAdText.headlines
  );

  // Process descriptions
  const updatedDescriptions = processAdTextArray(
    existingAdText.descriptions,
    newAdText.descriptions
  );

  return {
    headlines: updatedHeadlines,
    descriptions: updatedDescriptions
  };
}

// Helper function to process headlines or descriptions arrays
function processAdTextArray(existing, newItems) {
  // Remove 'new' label from existing items
  const updatedExisting = existing.map(item => {
    if (typeof item === 'string') {
      return item;
    }
    return {
      ...item,
      new: undefined
    };
  });

  // Add 'new' label to new items
  const processedNew = newItems.map(item => ({
    text: typeof item === 'string' ? item : item.text,
    new: true
  }));

  // Combine existing and new items
  // Filter out duplicates based on the text content
  const seen = new Set(updatedExisting.map(item => 
    typeof item === 'string' ? item : item.text
  ));
  const uniqueNew = processedNew.filter(item => 
    !seen.has(item.text)
  );

  return [...updatedExisting, ...uniqueNew];
}

app.post('/getCampaignBudget', async (req, res) => {
  const { businessName, campaignName } = req.body;

  try {
    // Fetch credentials from MongoDB
    const mongoClient = await getMongoClient();
    const db = mongoClient.db('credentials');
    const credentialsCollection = db.collection(businessName);
    const credentialsDoc = await credentialsCollection.findOne({});

    if (!credentialsDoc || !credentialsDoc.credentials) {
      return res.status(400).json({ success: false, message: 'Credentials not found.' });
    }

    const credentials = credentialsDoc.credentials;

    // Ensure the customer ID is correctly formatted (without dashes)
    const customerId = credentials.customer_id.replace(/-/g, '');

    // Initialize the Google Ads API client
    const client = new GoogleAdsApi({
      client_id: credentials.client_id,
      client_secret: credentials.client_secret,
      developer_token: credentials.developer_token,
    });

    const customer = client.Customer({
      customer_id: customerId,
      refresh_token: credentials.refresh_token,
    });

    // Fetch campaign budget
    const query = `
      SELECT
        campaign.id,
        campaign.name,
        campaign_budget.amount_micros
      FROM campaign
      WHERE campaign.name = '${campaignName}'
    `;

    const [campaignData] = await customer.query(query);

    if (!campaignData || !campaignData.campaign_budget) {
      return res.status(404).json({ success: false, message: 'Campaign or budget not found.' });
    }

    const budgetAmountMicros = campaignData.campaign_budget.amount_micros;
    const budgetAmount = budgetAmountMicros / 1000000; 
    res.json({
      success: true,
      budget: budgetAmount,
      campaignName: campaignData.campaign.name,
    });

  } catch (error) {
    console.error('Error fetching campaign budget:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch campaign budget.',
      error: error.message,
    });
  }
});

app.get('/createGoogleAds', async (req, res) => {
  const { businessName, ads } = req.query;
  console.log('business', businessName)
  console.log('ads', ads)

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  const sendEvent = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const parsedAds = JSON.parse(ads);

    // Fetch credentials from MongoDB
    const client = await getMongoClient();
    const db = client.db('credentials');
    const credentialsCollection = db.collection(businessName);
    const credentialsDoc = await credentialsCollection.findOne({});

    if (!credentialsDoc || !credentialsDoc.credentials) {
      sendEvent({ event: 'error', message: 'Credentials not found.' });
      return res.end();
    }

    const credentials = credentialsDoc.credentials;

    const scopes = [
      'https://www.googleapis.com/auth/adwords',
      'https://www.googleapis.com/auth/adwords.readonly'
    ];

    // Create ads
    for (const ad of parsedAds) {
      try {
        const payload = {
          credentials: {
            client_id: credentials.client_id,
            client_secret: credentials.client_secret,
            developer_token: credentials.developer_token,
            refresh_token: credentials.refresh_token,
            scopes: scopes
          },
          customer_id: credentials.customer_id,
          campaign_name: ad.campaignName,
          headlines: ad.headlines,
          descriptions: ad.descriptions,
          keywords: ad.keywords,
          final_url: ad.website
        };

        console.log('Sending payload:', JSON.stringify(payload, null, 2));

        const response = await axios.post('https://googleadsapicalls.onrender.com/create_ad', payload);

        console.log('Response:', response.data);

        sendEvent({ event: 'adCreated', ad: response.data });
      } catch (adError) {
        console.error('Error creating individual ad:', adError.response ? adError.response.data : adError.message);
        let errorMessage = 'Failed to create ad';

        if (adError.response && adError.response.data && adError.response.data.detail) {
          const errorDetail = adError.response.data.detail;
          const errorRegex = /string_value: "([^"]+)"/g;
          const matches = [...errorDetail.matchAll(errorRegex)];
          
          if (matches.length > 0) {
            const tooLongItems = matches.map(match => {
              const value = match[1];
              const isHeadline = errorDetail.indexOf(`"field_name": "headlines"`) < errorDetail.indexOf(match[0]);
              const maxLength = isHeadline ? 30 : 90;
              const overLength = value.length - maxLength;
              if (overLength > 0) {
                return `"${value}" is too long by ${overLength} character${overLength > 1 ? 's' : ''}`;
              }
              return null;
            }).filter(Boolean);
            
            if (tooLongItems.length > 0) {
              errorMessage = `The following items exceed the maximum length: ${tooLongItems.join(', ')}`;
            } else {
              errorMessage = 'An error occurred, but no specific length issues were found.';
            }
          } else {
            // If it's not a length error, include the full error detail
            errorMessage = errorDetail;
          }
        }
        
        sendEvent({ event: 'adError', error: errorMessage });
      }
    }
    sendEvent({ event: 'complete', message: 'All ads processed' });
  } catch (error) {
    console.error('Error creating Google Ads:', error);
    sendEvent({ event: 'error', message: 'Failed to create Google Ads.', error: error.message });
  } finally {
    res.end();
  }
});

app.post('/updateAd', async (req, res) => {
  const { businessName, adIndex, updatedAd } = req.body;
  console.log('updateAd**', updatedAd)
  try {
    // Update in MongoDB
    const client = await getMongoClient();
    const db = client.db('marketing_agent');
    const collection = db.collection(businessName);

    // Fetch the current document
    const doc = await collection.findOne({});
    if (!doc || !doc.list_of_ad_text) {
      return res.status(404).json({ success: false, message: 'Ad variations not found' });
    }

    const updateObject = {
      [`list_of_ad_text.${adIndex}.image`]: updatedAd.image,
      [`list_of_ad_text.${adIndex}.imageAsset`]: updatedAd.imageAsset
    };

    // Update the document in the database
    await collection.updateOne({}, { $set: updateObject });

    res.json({ 
      success: true, 
      message: 'Ad updated successfully',
      updatedAd: updatedAd
    });
  } catch (error) {
    console.error('Error updating ad:', error);
    res.status(500).json({ success: false, message: 'Failed to update ad' });
  }
});

// app.post('/updateCampaignBudget', async (req, res) => {
//   const { businessName, campaignName, newBudget } = req.body;
//   console.log('Received update budget request:', { businessName, campaignName, newBudget });

//   try {
//     // Fetch credentials from MongoDB
//     const db = mongoClient.db('credentials');
//     const credentialsCollection = db.collection(businessName);
//     const credentialsDoc = await credentialsCollection.findOne({});

//     if (!credentialsDoc || !credentialsDoc.credentials) {
//       return res.status(400).json({ success: false, message: 'Credentials not found.' });
//     }

//     const credentials = credentialsDoc.credentials;

//     // Ensure the customer ID is correctly formatted (without dashes)
//     const customerId = credentials.customer_id.replace(/-/g, '');

//     // Initialize the Google Ads API client
//     const client = new GoogleAdsApi({
//       client_id: credentials.client_id,
//       client_secret: credentials.client_secret,
//       developer_token: credentials.developer_token,
//     });

//     const customer = client.Customer({
//       customer_id: customerId,
//       refresh_token: credentials.refresh_token,
//     });

//     // Fetch campaign ID
//     const query = `
//       SELECT
//         campaign.id,
//         campaign.name,
//         campaign_budget.id,
//         campaign_budget.amount_micros,
//         campaign_budget.resource_name
//       FROM campaign
//       WHERE campaign.name = '${campaignName}'
//     `;

//     const [campaignData] = await customer.query(query);
//     console.log('data', campaignData);

//     if (!campaignData || !campaignData.campaign || !campaignData.campaign_budget) {
//       return res.status(404).json({ success: false, message: 'Campaign or budget not found.' });
//     }

//     console.log('Resource name:', campaignData.campaign_budget.resource_name);

//     const campaignBudgetOperation = {
//       update: {
//         resource_name: campaignData.campaign_budget.resource_name,
//         amount_micros: Long.fromNumber(newBudget * 1000000).toNumber(),
//       },
//       update_mask: {
//         paths: ['amount_micros']
//       }
//     };

//     const response = await axios.post(
//       `https://googleads.googleapis.com/v14/customers/${customerId}/campaignBudgets:mutate`,
//       {
//         operations: [campaignBudgetOperation]
//       },
//       {
//         headers: {
//           'Authorization': `Bearer ${credentials.refresh_token}`,
//           'developer-token': credentials.developer_token,
//           'login-customer-id': customerId,
//         }
//       }
//     );
  
//     console.log('Update result:', response.data);

//     res.json({
//       success: true,
//       message: 'Campaign budget updated successfully.',
//       campaignName: campaignData.campaign.name,
//       newBudget: newBudget,
//     });

//   } catch (error) {
//     console.error('Error updating campaign budget:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to update campaign budget.',
//       error: error.message,
//       stack: error.stack,
//     });
//   }
// });

app.post('/endSession', async (req, res) => {
  const { sessionId } = req.body;

  try {
    const client = await getMongoClient();
    const db = client.db('onboarding');
    const sessionsCollection = db.collection('sessions');
    await sessionsCollection.deleteOne({ sessionId });

    // Delete the session data from Redis
    await redisClient.del(`session:${sessionId}`);

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

// app.listen(port, () => {
//   console.log(`Server running on port ${port}`);
// });

// process.on('SIGINT', async () => {
//   await mongoClient.close();
//   process.exit();
// });

function validateEmailSyntax(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

async function triggerLambdaFunction(businessInfo) {
  const payload = {
    Records: [
      {
        body: JSON.stringify({
          business_name: businessInfo.name,
          website_link: businessInfo.website,
          business_context: businessInfo.business_context,
          email: businessInfo.email
        })
      }
    ]
  };

  const params = new InvokeCommand({
    FunctionName: process.env.LAMBDA_FUNCTION_ARN,
    InvocationType: 'Event', 
    Payload: JSON.stringify(payload)
  });

  try {
    console.log('sending***', params)
    const result = await lambdaClient.send(params);
    console.log('Lambda function triggered successfully:', result);
  } catch (error) {
    console.error('Error triggering Lambda function:', error);
  }
}