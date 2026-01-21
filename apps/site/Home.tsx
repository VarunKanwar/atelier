import { Box } from '@chakra-ui/react'
import HomeFeatureGrid from './components/home/HomeFeatureGrid'
import HomeHero from './components/home/HomeHero'

const Home = () => {
  const docsHref = '/docs'
  const exploreHref = '/explore'
  const githubHref = 'https://github.com/VarunKanwar/atelier'

  return (
    <Box minH="100vh">
      <HomeHero docsHref={docsHref} exploreHref={exploreHref} githubHref={githubHref} />
      <HomeFeatureGrid />
    </Box>
  )
}

export default Home
