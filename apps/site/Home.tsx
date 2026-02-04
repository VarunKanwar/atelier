import { Box } from '@chakra-ui/react'
import HomeFeatureGrid from './components/home/HomeFeatureGrid'
import HomeHero from './components/home/HomeHero'

const Home = () => {
  const docsHref = '/docs'
  const playgroundHref = '/playground'
  const githubHref = 'https://github.com/VarunKanwar/atelier'

  return (
    <Box minH="100vh">
      <HomeHero docsHref={docsHref} playgroundHref={playgroundHref} githubHref={githubHref} />
      <HomeFeatureGrid />
    </Box>
  )
}

export default Home
