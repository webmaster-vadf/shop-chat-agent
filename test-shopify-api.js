// test-shopify-api.js
import fetch from 'node-fetch';

const STOREFRONT_ACCESS_TOKEN = process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN;
const SHOP_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;

const query = `
  query {
    products(first: 5) {
      edges {
        node {
          id
          title
          description
          priceRange {
            minVariantPrice {
              amount
              currencyCode
            }
          }
        }
      }
    }
  }
`;

async function testStorefrontAPI() {
  try {
    const response = await fetch(`https://${SHOP_DOMAIN}/api/2023-10/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Storefront-Access-Token': STOREFRONT_ACCESS_TOKEN,
      },
      body: JSON.stringify({ query }),
    });

    const data = await response.json();
    console.log('Produits récupérés:', JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Erreur API Shopify:', error);
  }
}

testStorefrontAPI();