const { MongoClient } = require('mongodb');
const nodemailer = require('nodemailer');
require('dotenv').config();

const mongoClient = new MongoClient(process.env.MONGODB_URI);

async function sendEmail(to, subject, text) {
  console.log(`Preparing to send email to ${to}`);
  let transporter = nodemailer.createTransport({
    host: 'smtp.sendgrid.net',
    port: 587,
    auth: {
      user: 'apikey', // This is the literal string 'apikey', not your SendGrid username
      pass: process.env.SENDGRID_API_KEY
    }
  });

  let mailOptions = {
    from: process.env.SENDING_EMAIL,
    to: to,
    subject: subject,
    text: text
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Email sent successfully to ${to}`);
  } catch (error) {
    console.error(`Failed to send email to ${to}: ${error}`);
    throw error; // Re-throw the error to be caught in the calling function
  }
}

async function monitorAndSendEmails() {
  console.log('Starting monitorAndSendEmails function');
  try {
    console.log('Connecting to MongoDB...');
    await mongoClient.connect();
    console.log('Connected to MongoDB successfully');

    const onboardingDb = mongoClient.db('onboarding');
    const sessionsCollection = onboardingDb.collection('sessions');
    const marketingDb = mongoClient.db('marketing_agent');
    const judgeDataCollection = mongoClient.db('judge_data');

    console.log('Querying for sessions...');
    const sessions = await sessionsCollection.find({ emailSent: { $ne: true } }).toArray();
    console.log(`Found ${sessions.length} sessions to process`);

    for (const session of sessions) {
      console.log(`Processing session for business: ${session.businessInfo.name}`);
      const businessName = session.businessInfo.name;
      const email = session.businessInfo.email;

      console.log('Collections in marketing_agent database:');
      const collections = await marketingDb.listCollections().toArray();
      console.log(collections.map(c => c.name));

      console.log(`Fetching marketing data for ${businessName}`);
      const marketingData = await marketingDb.collection(businessName).findOne();
      console.log(`Marketing data found: ${!!marketingData}`);
      console.log('Marketing Data:', marketingData);
      
      console.log(`Fetching judge data for ${businessName}`);
      const judgeData = await judgeDataCollection.collection(businessName).findOne();
      console.log(`Judge data found: ${!!judgeData}`);
      console.log('Judge Data:', judgeData);

      if (marketingData && judgeData) {
        console.log(`Preparing email content for ${businessName}`);
        const emailContent = `
          Hello ${businessName},

          Here is the information generated by our AI agents:

          Business Description:
          ${marketingData.business}

          User Personas:
          ${marketingData.user_personas.map(persona => `- ${persona.name}: ${persona.description}`).join('\n')}

          Research Paths:
          ${marketingData.list_of_paths_taken.map(path => `- ${path}`).join('\n')}

          Keywords:
          ${Object.entries(judgeData.keywords).map(([keyword, data]) => `- ${keyword}: ${data.avg_monthly_searches} searches, Competition: ${data.competition}`).join('\n')}

          Ad Text Variations:
          ${judgeData.ad_variations.map(variation => `- Headline: ${variation.headlines.join(', ')}\n  Description: ${variation.descriptions.join(', ')}`).join('\n\n')}

          <p>If you would like to use AdAlchemyAI to automate your ads, let's <a href="https://calendly.com/emmanuel-emmanuelsibanda/30min">Schedule Time</a></p>

          Best regards,
          Emmanuel from AdAlchemyAI
        `;

        console.log(`Sending email to ${email}`);
        await sendEmail(email, 'AdAlchemyAI: Results to automate your Google Ads', emailContent);

        console.log(`Updating session for ${businessName}`);
        await sessionsCollection.updateOne(
          { _id: session._id },
          { $set: { emailSent: true } }
        );
        console.log(`Session updated for ${businessName}`);
      } else {
        console.log(`Missing data for ${businessName}. Marketing data: ${!!marketingData}, Judge data: ${!!judgeData}`);
      }
    }
  } catch (error) {
    console.error(`Error monitoring and sending emails: ${error}`);
  } finally {
    console.log('Closing MongoDB connection');
    await mongoClient.close();
  }
}

async function runEmailNotifier() {
  console.log('Starting email notifier...');
  try {
    await monitorAndSendEmails();
    console.log('Email notifier completed successfully');
  } catch (error) {
    console.error('Error running email notifier:', error);
  }
}

// Execute the function when the script is run directly
if (require.main === module) {
  runEmailNotifier();
}

module.exports = { monitorAndSendEmails };