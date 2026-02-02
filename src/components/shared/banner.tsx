import Image from 'next/image'
import React, { FC } from 'react'
import Navbar from './navbar'

type Props = {
  filter: string
  image: string
  title?: string
}

const Banner: FC<Props> = ({ filter, image, title }) => {
  const titleText = title ?? filter?.toUpperCase().replace('-', ' ')
  return (
    <div className='w-full overflow-hidden relative'>
      <Navbar />
      <div className='flex justify-center items-center pt-20 pb-5 md:pb-30'>
        <h1 className='text-4xl md:text-7xl font-bold text-white p-10 text-center'>
          {titleText}
        </h1>
      </div>
      <Image 
      src={image} 
      alt={titleText} 
      fill priority 
      className='object-cover absolute -z-10 brightness-75' />
    </div>
  )
}

export default Banner
