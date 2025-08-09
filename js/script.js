// api/recommend.js
const fetch = require('node-fetch');

// Helper for rate limiting
async function delayedFetch(url) {
  // Add a small delay to respect Jikan API rate limits
  await new Promise(resolve => setTimeout(resolve, 1000));
  return fetch(url).then(res => res.json());
}

module.exports = async (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With, Content-Type, Accept');

  // Handle OPTIONS request (for CORS preflight)
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { titles, genres, exclude, mediaType = 'manga' } = req.body;
    
    if (!titles || titles.length === 0) {
      return res.status(400).json({ error: 'Please provide at least one title' });
    }
    
    // Search for the title
    const searchResponse = await delayedFetch(
      `https://api.jikan.moe/v4/${mediaType}?q=${encodeURIComponent(titles[0])}&limit=1`
    );
    
    if (!searchResponse.data || searchResponse.data.length === 0) {
      return res.status(404).json({ error: `Could not find ${mediaType} with title "${titles[0]}"` });
    }
    
    const baseItem = searchResponse.data[0];
    
    // Get recommendations or top items as fallback
    let recommendations = [];
    
    if (mediaType === 'anime' || mediaType === 'manga') {
      try {
        // Try to get official recommendations
        const recsResponse = await delayedFetch(
          `https://api.jikan.moe/v4/${mediaType}/${baseItem.mal_id}/recommendations`
        );
        
        if (recsResponse.data && recsResponse.data.length > 0) {
          // Get details for top 5 recommendations
          const recDetails = await Promise.all(
            recsResponse.data.slice(0, 5).map(async rec => {
              const details = await delayedFetch(
                `https://api.jikan.moe/v4/${mediaType}/${rec.entry.mal_id}`
              );
              return details.data;
            })
          );
          
          recommendations = recDetails.map(item => formatItem(item, titles[0], mediaType));
        }
      } catch (error) {
        console.error('Error getting recommendations:', error);
        // Continue to fallback
      }
    }
    
    // If we don't have enough recommendations, add top items
    if (recommendations.length < 3) {
      const topResponse = await delayedFetch(
        `https://api.jikan.moe/v4/top/${mediaType}?limit=5`
      );
      
      const topItems = topResponse.data
        .filter(item => item.mal_id !== baseItem.mal_id)
        .map(item => formatItem(item, titles[0], mediaType));
      
      recommendations = [...recommendations, ...topItems];
    }
    
    // Return final recommendations (limit to 5)
    return res.status(200).json({ 
      recommendations: recommendations.slice(0, 5),
      baseTitle: baseItem.title,
      mediaType: mediaType
    });
    
  } catch (error) {
    console.error('Server error:', error);
    return res.status(500).json({ 
      error: 'Failed to get recommendations',
      details: error.message
    });
  }
};

// Helper to format item data
function formatItem(item, basedOn, mediaType) {
  if (mediaType === 'anime') {
    return {
      title: item.title,
      creator: item.studios?.map(s => s.name).join(', ') || 'Unknown',
      type: item.type || 'TV',
      genres: item.genres?.map(g => g.name) || [],
      description: item.synopsis || 'No description available',
      similarTo: basedOn,
      whyRecommended: 'Popular anime on MyAnimeList',
      image: item.images?.jpg?.image_url,
      url: item.url,
      score: item.score,
      episodes: item.episodes
    };
  } else {
    return {
      title: item.title,
      creator: item.authors?.map(a => a.name).join(', ') || 'Unknown',
      type: item.type || (mediaType === 'manhwa' ? 'Manhwa' : 'Manga'),
      genres: item.genres?.map(g => g.name) || [],
      description: item.synopsis || 'No description available',
      similarTo: basedOn,
      whyRecommended: `Popular ${mediaType} on MyAnimeList`,
      image: item.images?.jpg?.image_url,
      url: item.url,
      score: item.score,
      chapters: item.chapters
    };
  }
}